/**
 * API HTTP locale: le stesse URL e le stesse forme di risposta della versione
 * Python (`backend/src/terna_backend/api.py`), così la SPA non cambia.
 */
import { Hono } from "hono";

import {
  DATA_FIRST_YEAR,
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

function filtersFromQuery(query: URLSearchParams): RecordFilters {
  const text = (key: string): string | null => {
    const value = query.get(key);
    return value === null || value === "" ? null : value;
  };
  const years = (key: string): number | null => {
    const value = text(key);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const dataset = text("dataset");
  const capacityType = text("capacity_type");
  return {
    dataset: dataset && (DATASETS as readonly string[]).includes(dataset) ? (dataset as DatasetName) : null,
    year_from: years("year_from"),
    year_to: years("year_to"),
    region: text("region"),
    province: text("province"),
    source: text("source"),
    capacity_type: capacityType && (CAPACITY_TYPES as readonly string[]).includes(capacityType) ? (capacityType as CapacityType) : null,
    category: text("category"),
    subcategory: text("subcategory"),
    type: text("type"),
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
    const body = (await c.req.json()) as { client_id?: string; client_secret?: string };
    if (!body.client_id || !body.client_secret) {
      return c.json({ detail: "client_id and client_secret are required" }, 422);
    }
    settings.saveCredentials(body.client_id.trim(), body.client_secret.trim());
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
    const body = (await c.req.json()) as { years?: number[]; datasets?: DatasetName[] };
    if (!Array.isArray(body.years) || body.years.length === 0) {
      return c.json({ detail: "years must be a non-empty array" }, 422);
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

  app.get("/metadata/data-quality", (c) =>
    c.json({
      years: store.dataQuality(filtersFromQuery(new URL(c.req.url).searchParams)),
    }),
  );

  app.get("/records", (c) => {
    const query = new URL(c.req.url).searchParams;
    const limit = Math.min(100_000, Math.max(1, Number(query.get("limit") ?? 5000)));
    const offset = Math.max(0, Number(query.get("offset") ?? 0));
    return c.json(store.records(filtersFromQuery(query), limit, offset));
  });

  app.get("/analytics/summary", (c) => {
    const query = new URL(c.req.url).searchParams;
    return c.json(store.summary(filtersFromQuery(query)));
  });

  app.get("/analytics/timeseries", (c) => {
    const url = new URL(c.req.url);
    const groupBy = url.searchParams.get("group_by") ?? "year";
    try {
      parseGroupBy(groupBy);
    } catch (error) {
      return c.json({ detail: (error as Error).message }, 400);
    }
    const latestOnly = ["true", "1"].includes((url.searchParams.get("latest_only") ?? "").toLowerCase());
    return c.json(store.aggregate(filtersFromQuery(url.searchParams), groupBy, latestOnly));
  });

  app.get("/export/csv", (c) => {
    const query = new URL(c.req.url).searchParams;
    return new Response(store.toCsv(filtersFromQuery(query)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="italian-renewable-capacity-records.csv"',
      },
    });
  });

  return app;
}
