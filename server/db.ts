/**
 * Cache SQLite locale: schema, upsert idempotente, query di analisi ed export.
 * Porting fedele di `backend/src/terna_backend/storage.py` — stesso schema,
 * stesse chiavi, stessa semantica di "stock" (mai somme fra anni o fra indici).
 *
 * Le query passano da `prepare()` e le righe vengono lette tramite interfacce
 * dichiarate: bun:sqlite restituisce valori non tipizzati, quindi il cast
 * avviene una volta per query dentro una costante nominata.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_CAPACITY_TYPE } from "./constants.ts";
import { rowKey, type CapacityRow } from "./normalize.ts";
import { GROUP_BY_FIELDS } from "../shared/types.ts";
import type {
  AggregatePoint,
  Availability,
  AvailabilityDataset,
  CapacityRecord,
  DataQualityYear,
  DatasetName,
  RecordFilters,
  Summary,
} from "../shared/types.ts";

const EXACT_FIELDS = [
  "dataset",
  "region",
  "province",
  "source",
  "capacity_type",
  "category",
  "subcategory",
  "type",
] as const;

const MW_DATASET_NAMES: readonly DatasetName[] = [
  "renewable_source_capacity",
  "generation_plants",
  "thermoelectric_capacity",
];

type Bindings = Record<string, string | number | null>;

interface CountRow {
  n: number;
}
interface OptionRow {
  value: string | number;
}
interface AvailabilityRow {
  dataset: DatasetName;
  year: number;
  rows: number;
  sources: string | null;
  capacity_types: string | null;
  last_fetched: string | null;
}
interface TotalsRow {
  mw: number | null;
  gw: number | null;
}
interface YearRow {
  y: number | null;
}
interface SummaryBaseRow {
  row_count: number;
  year_min: number | null;
  year_max: number | null;
}

/** Colonne ordinabili di `/records`: whitelist, mai interpolazione libera. */
export const RECORD_SORT_FIELDS = [
  "dataset",
  "year",
  "region",
  "province",
  "source",
  "capacity_type",
  "type",
  "efficient_power_mw",
  "installed_capacity_gw",
] as const;

export function parseGroupBy(raw: string): string[] {
  const parts = (raw || "")
    .split(/[,+;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen: string[] = [];
  for (const part of parts) {
    if (!(GROUP_BY_FIELDS as readonly string[]).includes(part)) {
      throw new Error(`Unsupported group_by: ${raw}`);
    }
    if (!seen.includes(part)) seen.push(part);
  }
  if (seen.length === 0) throw new Error(`Unsupported group_by: ${raw}`);
  return seen;
}

export function recordKey(row: CapacityRow | Record<string, unknown>): string {
  return createHash("sha256").update(rowKey(row)).digest("hex");
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export class CapacityStore {
  readonly databasePath: string;
  private readonly db: Database;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    // Two processes on the same folder (a second instance, or a `bun test` run
    // next to the app) must wait for the write lock instead of failing a step
    // straight away with SQLITE_BUSY.
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
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

  /** Cache delle opzioni: cambiano solo quando arrivano righe nuove. */
  private optionsCache: Record<string, unknown[]> | null = null;

  /** Inserisce o aggiorna per `record_key`: risincronizzare non duplica righe. */
  private writeRecords(rows: CapacityRow[]): void {
    const statement = this.db.prepare(`
      INSERT INTO capacity_records (
        record_key, dataset, year, capacity_type, region, province, source,
        category, subcategory, type, efficient_power_mw, installed_capacity_gw, fetched_at
      ) VALUES (
        $record_key, $dataset, $year, $capacity_type, $region, $province, $source,
        $category, $subcategory, $type, $efficient_power_mw, $installed_capacity_gw, $fetched_at
      )
      ON CONFLICT(record_key) DO UPDATE SET
        -- Un file successivo senza valore non deve cancellare un valore già
        -- acquisito: il NULL è "cella vuota", non "zero".
        efficient_power_mw = COALESCE(excluded.efficient_power_mw, capacity_records.efficient_power_mw),
        installed_capacity_gw = COALESCE(excluded.installed_capacity_gw, capacity_records.installed_capacity_gw),
        fetched_at = excluded.fetched_at
    `);
    for (const row of rows) {
      // bun:sqlite vuole le chiavi dei parametri nominati con il prefisso `$`.
      statement.run({
        $record_key: recordKey(row),
        $dataset: row.dataset,
        $year: row.year,
        $capacity_type: row.capacity_type,
        $region: row.region,
        $province: row.province,
        $source: row.source,
        $category: row.category,
        $subcategory: row.subcategory,
        $type: row.type,
        $efficient_power_mw: row.efficient_power_mw,
        $installed_capacity_gw: row.installed_capacity_gw,
        $fetched_at: row.fetched_at,
      } as Bindings);
    }
  }

  upsertRecords(rows: CapacityRow[]): number {
    if (rows.length === 0) return 0;
    this.db.transaction(() => this.writeRecords(rows))();
    this.optionsCache = null;
    return rows.length;
  }

  /** Una risposta completa sostituisce le chiavi del suo dataset/anno. Un
   * payload vuoto non prova che Terna abbia ritirato un anno pubblicato. */
  replaceSnapshot(dataset: DatasetName, year: number, rows: CapacityRow[]): number {
    if (rows.length === 0) return 0;
    if (rows.some((row) => row.dataset !== dataset || row.year !== year)) {
      throw new Error(`Invalid ${dataset} snapshot for ${year}`);
    }
    const keys = new Set(rows.map(recordKey));
    this.db.transaction(() => {
      this.writeRecords(rows);
      const existing = this.db
        .prepare("SELECT record_key FROM capacity_records WHERE dataset = ? AND year = ?")
        .all(dataset, year) as { record_key: string }[];
      const remove = this.db.prepare("DELETE FROM capacity_records WHERE record_key = ?");
      for (const row of existing) {
        if (!keys.has(row.record_key)) remove.run(row.record_key);
      }
    })();
    this.optionsCache = null;
    return rows.length;
  }

  private where(filters: RecordFilters): { clause: string; params: Bindings } {
    const clauses: string[] = [];
    const params: Bindings = {};
    for (const field of EXACT_FIELDS) {
      const value = filters[field];
      if (value) {
        clauses.push(`${field} = $${field}`);
        params[`$${field}`] = value;
      }
    }
    if (filters.year_from !== null && filters.year_from !== undefined) {
      clauses.push("year >= $year_from");
      params.$year_from = filters.year_from;
    }
    // Ricerca libera: la fa il database, così la tabella non deve tenere in
    // memoria migliaia di righe solo per filtrarle nel browser.
    //
    // `instr(lower(...), lower($q))` invece di `LIKE`: nessun carattere jolly da
    // proteggere e niente `ESCAPE` da dichiarare nove volte. (Con `LIKE` e
    // l'escape era comunque corretto: una ricerca di "_" torna tutto perché
    // `renewable_source_capacity` contiene davvero degli underscore.)
    const search = filters.q?.trim().toLowerCase();
    if (search) {
      const columns = [
        "region",
        "province",
        "source",
        "category",
        "subcategory",
        "type",
        "capacity_type",
        "dataset",
        "CAST(year AS TEXT)",
      ];
      clauses.push(
        `(${columns.map((column) => `instr(lower(coalesce(${column}, '')), $q) > 0`).join(" OR ")})`,
      );
      params.$q = search;
    }
    if (filters.year_to !== null && filters.year_to !== undefined) {
      clauses.push("year <= $year_to");
      params.$year_to = filters.year_to;
    }
    return { clause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  /** Righe che i filtri selezionano: serve a dire "50 di 12.330" nell'interfaccia. */
  countRecords(filters: RecordFilters): number {
    const { clause, params } = this.where(filters);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM capacity_records ${clause}`)
      .get(params) as CountRow | null;
    return row?.n ?? 0;
  }

  records(
    filters: RecordFilters,
    limit = 5000,
    offset = 0,
    sort: { column: string; direction: "asc" | "desc" } = { column: "year", direction: "asc" },
  ): CapacityRecord[] {
    const { clause, params } = this.where(filters);
    const column = (RECORD_SORT_FIELDS as readonly string[]).includes(sort.column) ? sort.column : "year";
    const direction = sort.direction === "desc" ? "DESC" : "ASC";
    const rows = this.db
      .prepare(
        `SELECT dataset, year, capacity_type, region, province, source, category,
                subcategory, type, efficient_power_mw, installed_capacity_gw, fetched_at
         FROM capacity_records ${clause}
         -- Le colonne di spareggio rendono l'ordine totale: senza, due pagine
         -- consecutive potevano ripetere o saltare righe.
         ORDER BY ${column} ${direction}, dataset, year, region, province, source,
                  capacity_type, category, subcategory, type
         LIMIT $limit OFFSET $offset`,
      )
      .all({ ...params, $limit: limit, $offset: offset });
    return rows as CapacityRecord[];
  }

  /** Provincia → regione: serve a non offrire province di un'altra regione. */
  provinceRegions(): Record<string, string> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT province, region FROM capacity_records
         WHERE province IS NOT NULL AND province <> '' AND region IS NOT NULL AND region <> ''
         ORDER BY province`,
      )
      .all() as { province: string; region: string }[];
    return Object.fromEntries(rows.map((row) => [row.province, row.region]));
  }

  options(): Record<string, unknown[]> {
    if (this.optionsCache) return this.optionsCache;
    const fields = ["dataset", "year", "region", "province", "source", "capacity_type", "category", "subcategory", "type"];
    // Il tipo promette `categories`/`subcategories`: le chiavi si costruiscono
    // dal plurale vero, non aggiungendo una "s" a caso.
    const plurals: Record<string, string> = {
      dataset: "datasets",
      category: "categories",
      subcategory: "subcategories",
      capacity_type: "capacity_types",
    };
    const result: Record<string, unknown[]> = {};
    for (const field of fields) {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT ${field} AS value FROM capacity_records
           WHERE ${field} IS NOT NULL ORDER BY ${field}`,
        )
        .all() as OptionRow[];
      result[plurals[field] ?? `${field}s`] = rows.map((row) => row.value);
    }
    // Con 68.000 righe questo costava dieci scansioni complete a ogni
    // caricamento della dashboard: il risultato si tiene finché non cambiano i dati.
    this.optionsCache = result;
    return result;
  }

  availability(): Availability {
    const rows = this.db
      .prepare(
        `SELECT dataset, year, COUNT(*) AS rows,
                GROUP_CONCAT(DISTINCT source) AS sources,
                GROUP_CONCAT(DISTINCT capacity_type) AS capacity_types,
                MAX(fetched_at) AS last_fetched
         FROM capacity_records GROUP BY dataset, year ORDER BY dataset, year`,
      )
      .all() as AvailabilityRow[];
    const counted = this.db.prepare("SELECT COUNT(*) AS n FROM capacity_records").get() as CountRow | null;

    const datasets: Partial<Record<DatasetName, AvailabilityDataset>> = {};
    for (const row of rows) {
      const entry = (datasets[row.dataset] ??= {
        years: [],
        total_rows: 0,
        year_min: null,
        year_max: null,
        last_fetched: null,
      });
      entry.years.push({
        year: row.year,
        rows: row.rows,
        sources: (row.sources ?? "").split(",").filter(Boolean).sort(),
        capacity_types: (row.capacity_types ?? "").split(",").filter(Boolean).sort(),
      });
      entry.total_rows += row.rows;
      entry.year_min = entry.year_min === null ? row.year : Math.min(entry.year_min, row.year);
      entry.year_max = entry.year_max === null ? row.year : Math.max(entry.year_max, row.year);
      if (row.last_fetched && (entry.last_fetched === null || row.last_fetched > entry.last_fetched)) {
        entry.last_fetched = row.last_fetched;
      }
    }
    return { datasets, total_rows: counted?.n ?? 0 };
  }

  /**
   * Years whose file leaves cells empty although the same key (province,
   * source, index) carries a value in another year. An empty cell that is empty
   * every year is a source that does not exist there, and a zero elsewhere is a
   * zero — neither is a gap. Counted on the rows the filters select, so the
   * dashboard can warn about exactly what it is showing.
   *
   * Le due CTE servono a non fare un EXISTS correlato su ogni riga: con la
   * storia completa (68.000 righe) quella versione impiegava 48 secondi e,
   * essendo SQLite sincrono, bloccava tutto il server.
   */
  dataQuality(filters: RecordFilters): DataQualityYear[] {
    const { clause, params } = this.where(filters);
    const filtered = clause ? `${clause} ` : "";
    const value = (prefix: string) =>
      `(CASE WHEN ${prefix}dataset = 'installed_capacity' THEN ${prefix}installed_capacity_gw ELSE ${prefix}efficient_power_mw END)`;
    const rows = this.db
      .prepare(
        `WITH cells AS (
           SELECT dataset, region, province, source, capacity_type, category, subcategory, type, year,
                  MIN(CASE WHEN ${value("")} IS NULL THEN 1 ELSE 0 END) AS all_null,
                  MAX(CASE WHEN ${value("")} > 0 THEN 1 ELSE 0 END) AS is_positive
           FROM capacity_records
           ${filtered}GROUP BY dataset, region, province, source, capacity_type, category, subcategory, type, year
         ),
         keys AS (
           SELECT dataset, region, province, source, capacity_type, category, subcategory, type,
                  MIN(CASE WHEN is_positive = 1 THEN year END) AS first_positive,
                  MAX(CASE WHEN is_positive = 1 THEN year END) AS last_positive
           FROM cells
           GROUP BY dataset, region, province, source, capacity_type, category, subcategory, type
         )
         SELECT c.year, COUNT(*) AS missing_values
         FROM cells c
         JOIN keys k
           ON k.dataset = c.dataset AND k.region IS c.region AND k.province IS c.province
          AND k.source IS c.source AND k.capacity_type IS c.capacity_type
          AND k.category IS c.category AND k.subcategory IS c.subcategory AND k.type IS c.type
         -- Un buco è una cella vuota *dentro* la serie della chiave: prima che la
         -- serie inizi non manca nulla (nel 2000 il fotovoltaico in quella
         -- provincia semplicemente non esisteva), e dopo la fine nemmeno.
         WHERE c.all_null = 1 AND k.first_positive < c.year AND k.last_positive > c.year
         GROUP BY c.year ORDER BY c.year`,
      )
      .all(params) as DataQualityYear[];
    return rows;
  }

  /** Indice di capacità usato per i totali "stock" (uno solo, mai entrambi). */
  private capacityApplied(filters: RecordFilters): string | null {
    if (filters.dataset === "installed_capacity") return null;
    if (filters.dataset && !MW_DATASET_NAMES.includes(filters.dataset)) return null;
    return filters.capacity_type ?? DEFAULT_CAPACITY_TYPE;
  }

  private stockTotals(
    filters: RecordFilters,
    applied: string | null,
    year: number,
  ): { mw: number | null; gw: number | null } {
    const scoped: RecordFilters = { ...filters, year_from: year, year_to: year };
    if (applied) scoped.capacity_type = applied as RecordFilters["capacity_type"];
    const { clause, params } = this.where(scoped);
    const row = this.db
      .prepare(
        `SELECT SUM(efficient_power_mw) AS mw, SUM(installed_capacity_gw) AS gw
         FROM capacity_records ${clause}`,
      )
      .get(params) as TotalsRow | null;
    return { mw: row?.mw ?? null, gw: row?.gw ?? null };
  }

  private previousYear(filters: RecordFilters, latest: number): number | null {
    const scoped: RecordFilters = { ...filters, year_to: latest - 1 };
    const { clause, params } = this.where(scoped);
    const row = this.db
      .prepare(`SELECT MAX(year) AS y FROM capacity_records ${clause}`)
      .get(params) as YearRow | null;
    return row?.y ?? null;
  }

  summary(filters: RecordFilters): Summary {
    const applied = this.capacityApplied(filters);
    // Lo stesso indice dei totali: contare le righe di Lorda e Netta mentre i
    // totali ne usano una sola dava due numeri che non tornavano fra loro.
    const scoped = applied
      ? { ...filters, capacity_type: applied as RecordFilters["capacity_type"] }
      : filters;
    const { clause, params } = this.where(scoped);
    const base = this.db
      .prepare(
        `SELECT COUNT(*) AS row_count,
                MIN(year) AS year_min, MAX(year) AS year_max
         FROM capacity_records ${clause}`,
      )
      .get(params) as SummaryBaseRow | null;

    const totals: SummaryBaseRow = base ?? {
      row_count: 0,
      year_min: null,
      year_max: null,
    };

    const latestYear = totals.year_max;
    let latestMw: number | null = null;
    let latestGw: number | null = null;
    let previousYear: number | null = null;
    let previousMw: number | null = null;
    let previousGw: number | null = null;

    if (latestYear !== null) {
      const latest = this.stockTotals(filters, applied, latestYear);
      latestMw = latest.mw;
      latestGw = latest.gw;
      previousYear = this.previousYear(scoped, latestYear);
      // A year-over-year figure requires adjacent years in the same index.
      if (previousYear !== latestYear - 1) previousYear = null;
      if (previousYear !== null) {
        const previous = this.stockTotals(filters, applied, previousYear);
        previousMw = previous.mw;
        previousGw = previous.gw;
      }
    }

    const isGwDataset = filters.dataset === "installed_capacity";
    const primaryLatest = isGwDataset ? latestGw : latestMw;
    const primaryPrevious = isGwDataset ? previousGw : previousMw;
    const yoyNew =
      primaryLatest !== null && primaryPrevious !== null ? primaryLatest - primaryPrevious : null;
    const yoyPct = yoyNew !== null && primaryPrevious ? (yoyNew / primaryPrevious) * 100 : null;

    return {
      ...totals,
      latest_year: latestYear,
      latest_total_efficient_power_mw: latestMw,
      latest_total_installed_capacity_gw: latestGw,
      previous_year: previousYear,
      previous_total_efficient_power_mw: previousMw,
      yoy_new_mw: isGwDataset ? null : yoyNew,
      yoy_new_gw: isGwDataset ? yoyNew : null,
      yoy_pct: yoyPct,
      capacity_type_applied: applied,
    };
  }

  aggregate(filters: RecordFilters, groupBy: string, latestOnly = false): AggregatePoint[] {
    const keys = parseGroupBy(groupBy);
    // Stesso indice implicito dei totali: senza, un `group_by=source` senza
    // `capacity_type` somma Lorda e Netta e raddoppia ogni megawatt.
    const applied = this.capacityApplied(filters);
    const scoped: RecordFilters = applied ? { ...filters, capacity_type: applied as RecordFilters["capacity_type"] } : filters;
    const { clause, params } = this.where(scoped);
    const scopedClause = latestOnly
      ? clause
        ? `${clause} AND year = (SELECT MAX(year) FROM capacity_records ${clause})`
        : "WHERE year = (SELECT MAX(year) FROM capacity_records)"
      : clause;
    const columns = keys.join(", ");
    // Ogni riga espone tutte le dimensioni: quelle non raggruppate valgono NULL,
    // come nella risposta FastAPI (il frontend legge sempre `row[splitKey]`).
    const projection = GROUP_BY_FIELDS.map((field) =>
      keys.includes(field) ? field : `NULL AS ${field}`,
    ).join(", ");
    const rows = this.db
      .prepare(
        `SELECT ${projection},
                SUM(efficient_power_mw) AS efficient_power_mw,
                SUM(installed_capacity_gw) AS installed_capacity_gw
         FROM capacity_records ${scopedClause}
         GROUP BY ${columns}
         ORDER BY ${columns}`,
      )
      .all(params);
    return rows as AggregatePoint[];
  }

  /** `PRAGMA optimize` all'apertura: aggiorna le statistiche che SQLite usa per
   * scegliere gli indici, senza il costo di un ANALYZE completo. */
  optimize(): void {
    this.db.exec("PRAGMA optimize");
  }

  toCsv(filters: RecordFilters): string {
    const fields: (keyof CapacityRecord)[] = [
      "dataset",
      "year",
      "capacity_type",
      "region",
      "province",
      "source",
      "category",
      "subcategory",
      "type",
      "efficient_power_mw",
      "installed_capacity_gw",
      "fetched_at",
    ];
    const lines = [fields.join(",")];
    // The export promises "every row matching the filters": a single 100 000-row
    // page silently cut anything larger. Page over the counted total instead, so
    // the only limit left is the size of the selection.
    const total = this.countRecords(filters);
    const pageSize = 50_000;
    for (let offset = 0; offset < total; offset += pageSize) {
      // `records` breaks ties on every column, so consecutive pages cannot
      // repeat or skip a row.
      const page = this.records(filters, pageSize, offset);
      if (page.length === 0) break;
      for (const row of page) {
        lines.push(fields.map((field) => csvField(row[field])).join(","));
      }
    }
    // UTF-8 BOM: without it Excel on Windows reads the accented place names
    // ("Forlì-Cesena", "Vallée d'Aoste") as mojibake.
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  /**
   * Riscrive i nomi di regione/provincia che Terna pubblica in modo incoerente
   * (uno zero al posto del trattino, due grafie per la Valle d'Aosta): senza,
   * la stessa provincia compare due volte e la sua serie resta spezzata.
   * Idempotente: le righe già canoniche non vengono toccate.
   */
  repairPlaceNames(fixes: Record<string, string>): number {
    type StoredRow = CapacityRecord & { id: number };
    let repaired = 0;
    // `id <> ?` esclude la riga in esame: senza, dopo la rinomina il controllo
    // trovava la riga stessa e la cancellava come se fosse un doppione (due
    // esecuzioni sovrapposte, o un riavvio a metà, perdevano quel dato).
    const check = this.db.prepare(
      `SELECT COUNT(*) AS n FROM capacity_records
       WHERE id <> ? AND dataset = ? AND year = ? AND province IS ? AND source IS ?
         AND capacity_type IS ? AND category IS ? AND subcategory IS ? AND type IS ? AND region IS ?`,
    );
    const move = this.db.prepare(
      `UPDATE capacity_records SET region = $region, province = $province, record_key = $record_key WHERE id = $id`,
    );
    const drop = this.db.prepare("DELETE FROM capacity_records WHERE id = ?");
    const stale = this.db
      .prepare(
        `SELECT * FROM capacity_records WHERE ${Object.keys(fixes)
          .map((_, index) => `province = $p${index} OR region = $p${index}`)
          .join(" OR ")}`,
      )
      .all({ ...Object.fromEntries(Object.keys(fixes).map((name, index) => [`$p${index}`, name])) }) as StoredRow[];

    const run = this.db.transaction((rows: StoredRow[]) => {
      for (const row of rows) {
        const region = fixes[row.region as string] ?? row.region;
        const province = fixes[row.province as string] ?? row.province;
        if (region === row.region && province === row.province) continue;
        const twin = check.get(
          row.id,
          row.dataset,
          row.year,
          province,
          row.source,
          row.capacity_type,
          row.category,
          row.subcategory,
          row.type,
          region,
        ) as CountRow | null;
        if (twin && twin.n > 0) {
          // La riga canonica esiste già: questa è un doppione da rimuovere.
          drop.run(row.id);
        } else {
          move.run({
            $region: region,
            $province: province,
            $record_key: recordKey({ ...row, region, province }),
            $id: row.id,
          });
        }
        repaired += 1;
      }
    });
    run(stale);
    // A repair renames rows: the option lists (province, region, type…) built
    // before it are stale, and a repair at runtime must not answer with the
    // old names.
    this.optionsCache = null;
    return repaired;
  }

  close(): void {
    this.db.close();
  }
}
