/**
 * La forma delle tabelle della cache: il DDL e le righe che le query leggono.
 *
 * Il DDL sta qui e non nel negozio perché è l'unica cosa che descrive *cosa*
 * esiste nel database; `server/db.ts` resta l'orchestrazione (apertura,
 * upsert, query). Le interfacce sono le forme delle righe che bun:sqlite
 * restituisce non tipizzate: il cast avviene una volta per query, nel punto in
 * cui la query è scritta.
 */
import type { Database } from "bun:sqlite";

import type { DatasetName } from "../../shared/types.ts";

/** Righe contate: `SELECT COUNT(*) AS n`. */
export interface CountRow {
  n: number;
}

/** Valore di una colonna DISTINCT: `SELECT <colonna> AS value`. */
export interface OptionRow {
  value: string | number;
}

/** Una riga per dataset/anno di `/metadata/availability`. */
export interface AvailabilityRow {
  dataset: DatasetName;
  year: number;
  rows: number;
  sources: string | null;
  capacity_types: string | null;
  last_fetched: string | null;
}

/** Totali "stock" di un anno: mai entrambi gli indici nella stessa somma. */
export interface TotalsRow {
  mw: number | null;
  gw: number | null;
}

/** Ultimo anno disponibile per i filtri dati. */
export interface YearRow {
  y: number | null;
}

/** Base del riepilogo: conteggio e intervallo degli anni. */
export interface SummaryBaseRow {
  row_count: number;
  year_min: number | null;
  year_max: number | null;
}

export function createSchema(db: Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS capacity_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_key TEXT NOT NULL UNIQUE,
        dataset TEXT NOT NULL,
        year INTEGER NOT NULL,
        capacity_type TEXT,
        region TEXT,
        province TEXT,
        source TEXT,
        category TEXT,
        subcategory TEXT,
        type TEXT,
        efficient_power_mw REAL,
        installed_capacity_gw REAL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_capacity_filters
        ON capacity_records (dataset, year, region, province, source, capacity_type);
      CREATE INDEX IF NOT EXISTS idx_capacity_year ON capacity_records (year);
    `);
}
