/**
 * Rotte di sola lettura: stato, metadati, record, analisi ed export CSV.
 *
 * Nessuna di queste tocca le credenziali o i job di sync: quelle stanno in
 * `server/api-sync.ts`. Qui vive anche la validazione dei filtri di query,
 * tramite `withFilters` (`server/api-support.ts`).
 */
import type { Hono } from "hono";

import {
  DATA_FIRST_YEAR,
  DEFAULT_CAPACITY_TYPE,
  DEFAULT_RECORD_LIMIT,
  DATASET_SOURCES,
  INSTALLED_CAPACITY_FIRST_YEAR,
  INSTALLED_CAPACITY_TYPES,
  currentYear,
} from "./constants.ts";
import { parseGroupBy, RECORD_SORT_FIELDS } from "./db.ts";
import { FilterError, withFilters, type ApiDependencies } from "./api-support.ts";
import pkg from "../package.json" with { type: "json" };
import { CAPACITY_TYPES, type HealthStatus } from "../shared/types.ts";

export function registerReadRoutes(app: Hono, { store, serverInfo }: ApiDependencies): void {
  // Oltre a "sono vivo": versione, porta effettiva e se il server ha ripiegato
  // su una porta libera. La UI lo legge prima di proporre di installare la PWA,
  // che resta legata all'origine (quindi alla porta) del momento dell'installazione.
  app.get("/health", (c) => c.json({ status: "ok", version: pkg.version, ...serverInfo() } satisfies HealthStatus));

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
}
