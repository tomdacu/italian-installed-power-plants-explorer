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
import { parseGroupBy, RECORD_SORT_FIELDS, type CapacityStore } from "./db.ts";
import type { SettingsStore } from "./settings.ts";
import { buildPlan, SYNCABLE_DATASETS, type SyncManager } from "./sync.ts";
import pkg from "../package.json" with { type: "json" };
import { CAPACITY_TYPES, DATASETS, type CapacityType, type CredentialStatus, type DatasetName, type HealthStatus, type RecordFilters } from "../shared/types.ts";

interface Dependencies {
  store: CapacityStore;
  settings: SettingsStore;
  sync: SyncManager;
  /** Dove finiscono i guasti interni: lo stesso `logger` del server. */
  logger?: (message: string) => void;
  /**
   * Porta effettiva e ripiego su una porta libera. È una funzione e non due
   * valori perché con `port: 0` la porta la sceglie il sistema operativo solo
   * dentro `Bun.serve`, cioè dopo che `createApi` è già stato costruito.
   */
  serverInfo: () => { port: number; port_fallback: boolean };
}

/**
 * La riga di un guasto interno, scritta **una volta sola**: la usano il gestore
 * `error` di `Bun.serve` (`server/http.ts`, per gli errori fuori dagli handler)
 * e `app.onError` qui sotto, perché Hono intercetta da sé gli errori degli
 * handler e senza `onError` non passerebbero mai né dal logger né da Bun.
 */
export function logInternalError(error: unknown, logger?: (message: string) => void): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (logger) logger(`internal error: ${detail}`);
  else console.error(error);
}

/** Corpo JSON non valido = 422 (il 400 è per i filtri di query), non un 500 con stack trace. */
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

/**
 * Oltre questa lunghezza la `q` non arrivava nemmeno ai validatori: la richiesta
 * falliva a livello di trasporto (505/reset) e il client parlava di «service non
 * rispondente». Un rifiuto esplicito è più utile di una connessione caduta.
 */
const MAX_QUERY_LENGTH = 200;

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

  const q = text("q");
  if (q !== null && q.length > MAX_QUERY_LENGTH) {
    throw new FilterError(`q must be at most ${MAX_QUERY_LENGTH} characters`);
  }

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
    q,
  };
}

/**
 * Maschera un client id: restano solo le ultime quattro cifre, e un id che ne ha
 * quattro o meno viene coperto per intero (prima tornava in chiaro).
 */
function maskClientId(clientId: string): string {
  if (clientId.length <= 4) return "*".repeat(clientId.length);
  return `${"*".repeat(clientId.length - 4)}${clientId.slice(-4)}`;
}

/** Context Hono ridotto a ciò che serve: il wrapper resta indipendente dai tipi del router. */
interface FilterContext {
  req: { url: string };
  json: (body: unknown, status?: number, headers?: Record<string, string>) => Response;
}

/** Avvolge un handler: i filtri non validi diventano 400, non 500. */
function withFilters(handler: (
  filters: RecordFilters,
  c: FilterContext,
  query: URLSearchParams,
) => Response | Promise<Response>) {
  return async (c: FilterContext) => {
    const query = new URL(c.req.url).searchParams;
    try {
      return await handler(filtersFromQuery(query), c, query);
    } catch (error) {
      if (error instanceof FilterError) return c.json({ detail: error.message }, 400);
      throw error;
    }
  };
}

export function createApi({ store, settings, sync, logger, serverInfo }: Dependencies): Hono {
  const app = new Hono();

  // Un handler che fallisce (per esempio il database che non risponde) è un
  // guasto interno come gli altri: stessa risposta JSON e stessa riga di log.
  app.onError((error, c) => {
    logInternalError(error, logger);
    return c.json({ detail: "internal error" }, 500);
  });

  // Senza questo, una rotta API inesistente riceveva il 404 predefinito di Hono,
  // in `text/plain`: il commento del server promette JSON dappertutto. Gli header
  // di sicurezza li aggiunge comunque `withSecurityHeaders` in `server/http.ts`.
  app.notFound((c) => c.json({ detail: "Not found" }, 404));

  const credentialStatus = async (): Promise<CredentialStatus> => {
    const current = settings.load();
    const clientId = current.clientId;
    return {
      configured: await settings.hasCredentials(),
      // Un id di 4 caratteri (o meno) non ha "ultime quattro cifre" da
      // mostrare: la maschera copre tutto l'id invece di restituirlo intero.
      client_id_suffix: clientId ? maskClientId(clientId) : null,
    };
  };

  // Oltre a "sono vivo": versione, porta effettiva e se il server ha ripiegato
  // su una porta libera. La UI lo legge prima di proporre di installare la PWA,
  // che resta legata all'origine (quindi alla porta) del momento dell'installazione.
  app.get("/health", (c) => c.json({ status: "ok", version: pkg.version, ...serverInfo() } satisfies HealthStatus));

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
    if (Array.isArray(body.datasets)) {
      const unknown = body.datasets.filter((dataset) => !DATASETS.includes(dataset));
      if (unknown.length > 0) {
        return c.json({ detail: `unknown datasets: ${unknown.join(", ")}` }, 422);
      }
    }
    // Ogni voce deve essere un anno intero: `map(Number).filter(isFinite)`
    // faceva sparire `"abc"` (contata come zero anni) e trasformava `null` e
    // `true` in 0 e 1, cioè in anni che nessuno aveva chiesto. Il dettaglio
    // nomina la voce, così si sa quale correggere.
    const invalid = body.years.findIndex((year) => typeof year !== "number" || !Number.isInteger(year));
    if (invalid >= 0) {
      return c.json(
        { detail: `years[${invalid}] must be an integer year, got ${JSON.stringify(body.years[invalid])}` },
        422,
      );
    }
    // Stessa funzione che usa la UI: un intervallo assurdo (1900-2100) non può
    // trasformarsi in centinaia di richieste e bruciare la quota Terna.
    const { years, skipped } = clampYears(body.years);
    if (years.length === 0) {
      return c.json(
        { detail: `no year between ${DATA_FIRST_YEAR} and ${currentYear()} was requested` },
        422,
      );
    }
    // Il piano si costruisce **prima** di accodare il job: un rifiuto non deve
    // lasciare nella mappa un job che non è mai stato eseguito.
    const plan = buildPlan({ years, datasets: body.datasets });
    // Gli anni limati da `clampYears` sono passi mai eseguiti come quelli che un
    // dataset non pubblica: senza, `skipped_steps` restava a zero e il job
    // sembrava aver coperto un intervallo che non ha mai chiesto. `clampYears`
    // conta **anni**, il piano conta **passi**: un anno limato vale un passo per
    // ciascun dataset scelto, così `total_steps + skipped_steps` resta
    // `anni unici × dataset` (docs/api.md).
    plan.dropped += skipped * (body.datasets ?? SYNCABLE_DATASETS).length;
    // Un piano che non contiene nemmeno un passo (tutti gli anni sotto la soglia
    // del dataset scelto) non è un job: meglio dirlo subito che restituire un
    // "completed" che non ha scaricato niente.
    if (plan.steps.length === 0) {
      return c.json({ detail: "no step to run for the requested years and datasets" }, 422);
    }
    const jobId = sync.start(plan);
    return c.json({ job_id: jobId, status: "queued" });
  });

  app.get("/sync/jobs/latest", (c) => {
    const status = sync.latestStatus();
    if (!status) return c.json({ detail: "Sync job not found" }, 404);
    return c.json(status);
  });

  app.get("/sync/jobs/:jobId", (c) => {
    const status = sync.status(c.req.param("jobId"));
    if (!status) return c.json({ detail: "Sync job not found" }, 404);
    return c.json(status);
  });

  // Cancellazione: 200 con lo stato del job (idempotente — su un job già finito
  // risponde con lo stato che ha, senza inventare un esito), 404 se l'id è
  // ignoto. Lo stato è `cancelled` appena la richiesta è accettata: il passo in
  // volo finisce comunque, e i contatori restano quelli veri.
  app.delete("/sync/jobs/:jobId", (c) => {
    const status = sync.cancel(c.req.param("jobId"));
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
      database: { ...store.options(), province_region: store.provinceRegions() },
    }),
  );

  app.get("/metadata/availability", (c) => c.json(store.availability()));

  app.get(
    "/metadata/data-quality",
    withFilters((filters, c) => c.json({ years: store.dataQuality(filters) })),
  );

  app.get("/records", withFilters((filters, c, query) => {
    // `limit=abc` faceva arrivare un NaN fino a SQLite: 500 invece di una
    // risposta sensata. Qui si valida e si risponde sempre qualcosa. `limit=0`
    // e `offset=-1` erano limati in silenzio (una riga, zero): l'utente non
    // poteva distinguere un filtro rispettato da uno aggiustato a mano.
    const integer = (key: string, fallback: number, min: number, max: number): number | null => {
      const raw = query.get(key);
      if (raw === null || raw === "") return fallback;
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < min) return null;
      return Math.min(max, value);
    };
    const limit = integer("limit", DEFAULT_RECORD_LIMIT, 1, 100_000);
    const offset = integer("offset", 0, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) {
      return c.json({ detail: "limit must be a positive integer and offset a non-negative integer" }, 400);
    }
    // Ordinamento esplicito: con un limite, l'ordine deciso dal database
    // significava che una selezione grande mostrava sempre le righe più vecchie.
    const sort = query.get("sort") ?? "year";
    const direction = (query.get("order") ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
    if (!RECORD_SORT_FIELDS.includes(sort as (typeof RECORD_SORT_FIELDS)[number])) {
      return c.json({ detail: `sort must be one of: ${RECORD_SORT_FIELDS.join(", ")}` }, 400);
    }
    const rows = store.records(filters, limit, offset, { column: sort, direction });
    return c.json(rows, 200, {
      // Il conteggio vero, così l'interfaccia può dire "50 di 12.330 righe"
      // invece di far credere che la selezione finisca dove finisce la pagina.
      "x-total-count": String(store.countRecords(filters)),
      "access-control-expose-headers": "x-total-count",
    });
  }));

  app.get(
    "/analytics/summary",
    withFilters((filters, c) => c.json(store.summary(filters))),
  );

  app.get("/analytics/timeseries", withFilters((filters, c, query) => {
    const groupBy = query.get("group_by") ?? "year";
    try {
      parseGroupBy(groupBy);
    } catch (error) {
      throw new FilterError((error as Error).message);
    }
    const latestOnly = ["true", "1"].includes((query.get("latest_only") ?? "").toLowerCase());
    return c.json(store.aggregate(filters, groupBy, latestOnly));
  }));

  app.get("/export/csv", withFilters((filters) => {
    return new Response(store.toCsv(filters), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="italian-renewable-capacity-records.csv"',
      },
    });
  }));

  return app;
}
