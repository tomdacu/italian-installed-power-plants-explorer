/**
 * Filtri, ordinamenti e paginazione delle query su `capacity_records`.
 *
 * Tutto ciò che traduce una richiesta in SQL sta qui: la clausola WHERE dei
 * filtri, la whitelist delle colonne ordinabili e la coda ORDER BY/LIMIT/OFFSET.
 * Nessuna query cambia forma: `server/db.ts` compone gli stessi testi con questi
 * frammenti.
 */
import { GROUP_BY_FIELDS, type RecordFilters } from "../../shared/types.ts";

/** Colonne su cui un filtro è un confronto esatto: le altre hanno regole proprie. */
export const EXACT_FIELDS = [
  "dataset",
  "region",
  "province",
  "source",
  "capacity_type",
  "category",
  "subcategory",
  "type",
] as const;

/** Parametri nominati di bun:sqlite: chiave con il prefisso `$`. */
export type Bindings = Record<string, string | number | null>;

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

/** Clausola WHERE dei filtri: vuota quando non filtra niente. */
export function buildWhere(filters: RecordFilters): { clause: string; params: Bindings } {
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

/**
 * Coda di `records()`: ordinamento e finestra.
 *
 * Le colonne di spareggio rendono l'ordine totale: senza, due pagine
 * consecutive potevano ripetere o saltare righe. Una colonna fuori whitelist
 * ricade su `year`, e l'unica direzione diversa da `ASC` è `DESC`.
 */
export function recordsOrderAndPage(sort: { column: string; direction: "asc" | "desc" }): string {
  const column = (RECORD_SORT_FIELDS as readonly string[]).includes(sort.column) ? sort.column : "year";
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  return `ORDER BY ${column} ${direction}, dataset, year, region, province, source,
                  capacity_type, category, subcategory, type
         LIMIT $limit OFFSET $offset`;
}
