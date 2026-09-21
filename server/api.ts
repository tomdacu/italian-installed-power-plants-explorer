/**
 * API HTTP locale: le stesse URL e le stesse forme di risposta della versione
 * Python (`backend/src/terna_backend/api.py`), così la SPA non cambia.
 */
import { Hono } from "hono";

import {
  DATA_FIRST_YEAR,
  DEFAULT_RECORD_LIMIT,
  DEFAULT_CAPACITY_TYPE,
  DATASET_SOURCES,
  INSTALLED_CAPACITY_FIRST_YEAR,
  INSTALLED_CAPACITY_TYPES,
  clampYears,
  currentYear,
} from "./constants.ts";
import { createTernaClient } from "./client.ts";
import { parseGroupBy, type CapacityStore } from "./db.ts";
import type { SettingsStore } from "./settings.ts";
import type { SyncManager } from "./sync.ts";
import { CAPACITY_TYPES, DATASETS, type CapacityType, type CredentialStatus, type DatasetName, type RecordFilters } from "../shared/types.ts";

interface Dependencies {
  store: CapacityStore;
  settings: SettingsStore;
  sync: SyncManager;
}

/** Corpo JSON non valido = 400, non un 500 con stack trace. */
async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Errore di validazione di un filtro: rispondere con *tutto* quando il valore
 * non è riconosciuto (comportamento precedente) è peggio di un 400, perché
 * l'utente crede di aver filtrato e vede invece l'intero database.
 */
class FilterError extends Error {}

function filtersFromQuery(query: URLSearchParams): RecordFilters {
  const text = (key: string): string | null => {
    const value = query.get(key);
    return value === null || value === "" ? null : value;
  };
  const years = (key: string): number | null => {
    const value = text(key);
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new FilterError(`${key} must be an integer year`);
    return parsed;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fold = false): T | null => {
    const raw = text(key);
    if (raw === null) return null;
    const value = fold ? raw.toLowerCase() : raw;
    const match = fold ? allowed.find((candidate) => candidate.toLowerCase() === value) : allowed.find((candidate) => candidate === raw);
    if (!match) throw new FilterError(`${key} must be one of: ${allowed.join(", ")}`);
    return match;
  };

  return {
    dataset: oneOf<DatasetName>("dataset", DATASETS as readonly DatasetName[]),
    year_from: years("year_from"),
    year_to: years("year_to"),
    region: text("region"),
    province: text("province"),
    source: text("source"),
    // `capacity_type=netta` applicava in silenzio Lorda: ora il confronto non
    // distingue le maiuscole e un valore ignoto è un errore.
    capacity_type: oneOf<CapacityType>("capacity_type", CAPACITY_TYPES as readonly CapacityType[], true),
    category: text("category"),
    subcategory: text("subcategory"),
    type: text("type"),
  };
}

/** Context Hono ridotto a ciò che serve: il wrapper resta indipendente dai tipi del router. */
interface FilterContext {
  req: { url: string };
  json: (body: unknown, status?: number) => Response;
}

/** Avvolge un handler: i filtri non validi diventano 400, non 500. */
function withFilters(handler: (filters: RecordFilters, c: FilterContext) => Response | Promise<Response>) {
  return async (c: FilterContext) => {
    const query = new URL(c.req.url).searchParams;
    try {
      return await handler(filtersFromQuery(query), c);
    } catch (error) {
      if (error instanceof FilterError) return c.json({ detail: error.message }, 400);
      throw error;
    }
  };
}

export function createApi({ store, settings, sync }: Dependencies): Hono {
  const app = new Hono();

  const credentialStatus = async (): Promise<CredentialStatus> => {
    const current = settings.load();
    const clientId = current.clientId;
    return {
      configured: await settings.hasCredentials(),
      client_id_suffix: clientId ? clientId.slice(-4).padStart(clientId.length, "*") : null,
    };
  };

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/settings/credentials/status", async (c) => c.json(await credentialStatus()));

  app.post("/settings/credentials", async (c) => {
    const body = await readJsonBody(c);
    if (typeof body?.client_id !== "string" || typeof body.client_secret !== "string") {
      return c.json({ detail: "client_id and client_secret are required" }, 422);
    }
    if (!body.client_id.trim() || !body.client_secret.trim()) {
      return c.json({ detail: "client_id and client_secret cannot be blank" }, 422);
    }
    await settings.saveCredentials(body.client_id.trim(), body.client_secret.trim());
    return c.json(await credentialStatus());
  });

  app.delete("/settings/credentials", async (c) => {
    await settings.deleteCredentials();
    return c.json(await credentialStatus());
  });

  app.post("/settings/credentials/test", async (c) => {
    try {
      const client = await createTernaClient(settings);
      await client.testCredentials();
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ detail: (error as Error).message }, 502);
    }
  });

  app.post("/sync/jobs", async (c) => {
    const body = (await readJsonBody(c)) as { years?: number[]; datasets?: DatasetName[] } | null;
    if (!body || !Array.isArray(body.years) || body.years.length === 0) {
      return c.json({ detail: "years must be a non-empty array" }, 422);
    }
    if (body.datasets !== undefined && !Array.isArray(body.datasets)) {
      return c.json({ detail: "datasets must be an array of dataset names" }, 422);
    }
    if (Array.isArray(body.datasets) && body.datasets.length === 0) {
      return c.json({ detail: "datasets cannot be empty when provided" }, 422);
    }
    // Stessa funzione che usa la UI: un intervallo assurdo (1900-2100) non può
    // trasformarsi in centinaia di richieste e bruciare la quota Terna.
    const { years } = clampYears(body.years.map(Number).filter(Number.isFinite));
    if (years.length === 0) {
      return c.json(
        { detail: `no year between ${DATA_FIRST_YEAR} and ${currentYear()} was requested` },
        422,
      );
    }
    const jobId = sync.start({ years, datasets: body.datasets });
    return c.json({ job_id: jobId, status: "queued" });
  });

  app.get("/sync/jobs/:jobId", (c) => {
    const status = sync.status(c.req.param("jobId"));
    if (!status) return c.json({ detail: "Sync job not found" }, 404);
    return c.json(status);
  });

  app.get("/metadata/options", (c) =>
    c.json({
      known_sources: DATASET_SOURCES.renewable_source_capacity,
      known_generation_plant_sources: DATASET_SOURCES.generation_plants,
      known_installed_capacity_types: INSTALLED_CAPACITY_TYPES,
      known_capacity_types: CAPACITY_TYPES,
      dataset_sources: DATASET_SOURCES,
      default_capacity_type: DEFAULT_CAPACITY_TYPE,
      first_year: DATA_FIRST_YEAR,
      installed_capacity_first_year: INSTALLED_CAPACITY_FIRST_YEAR,
      current_year: currentYear(),
      database: store.options(),
    }),
  );

  app.get("/metadata/availability", (c) => c.json(store.availability()));

  app.get(
    "/metadata/data-quality",
    withFilters((filters, c) => c.json({ years: store.dataQuality(filters) })),
  );

  app.get("/records", async (c) => {
    const query = new URL(c.req.url).searchParams;
    let filters;
    try {
      filters = filtersFromQuery(query);
    } catch (error) {
      if (error instanceof FilterError) return c.json({ detail: error.message }, 400);
      throw error;
    }
    // `limit=abc` faceva arrivare un NaN fino a SQLite: 500 invece di una
    // risposta sensata. Qui si valida, si lima e si risponde sempre qualcosa.
    const numeric = (key: string, fallback: number, min: number, max: number): number | null => {
      const raw = query.get(key);
      if (raw === null || raw === "") return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      return Math.min(max, Math.max(min, Math.trunc(value)));
    };
    const limit = numeric("limit", DEFAULT_RECORD_LIMIT, 1, 100_000);
    const offset = numeric("offset", 0, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) {
      return c.json({ detail: "limit and offset must be numbers" }, 400);
    }
    const rows = store.records(filters, limit, offset);
    return c.json(rows, 200, {
      // Il conteggio vero, così l'interfaccia può dire "50 di 12.330 righe"
      // invece di far credere che la selezione finisca dove finisce la pagina.
      "x-total-count": String(store.countRecords(filters)),
      "access-control-expose-headers": "x-total-count",
    });
  });

  app.get(
    "/analytics/summary",
    withFilters((filters, c) => c.json(store.summary(filters))),
  );

  app.get("/analytics/timeseries", async (c) => {
    const url = new URL(c.req.url);
    const groupBy = url.searchParams.get("group_by") ?? "year";
    let filters;
    try {
      parseGroupBy(groupBy);
      filters = filtersFromQuery(url.searchParams);
    } catch (error) {
      return c.json({ detail: (error as Error).message }, 400);
    }
    const latestOnly = ["true", "1"].includes((url.searchParams.get("latest_only") ?? "").toLowerCase());
    return c.json(store.aggregate(filters, groupBy, latestOnly));
  });

  app.get("/export/csv", async (c) => {
    const query = new URL(c.req.url).searchParams;
    let filters;
    try {
      filters = filtersFromQuery(query);
    } catch (error) {
      return c.json({ detail: (error as Error).message }, 400);
    }
    return new Response(store.toCsv(filters), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="italian-renewable-capacity-records.csv"',
      },
    });
  });

  return app;
}
