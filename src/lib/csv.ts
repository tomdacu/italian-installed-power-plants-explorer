/**
 * CSV serialization for the chart export buttons.
 *
 * The cell rules (quoting, formula-injection apostrophe, BOM) live in
 * `shared/csv.ts` — the same module the server exporter uses — so the two
 * exports cannot drift apart. Here only the table shape and the rounding the
 * charts need.
 */
import { CSV_BOM, csvField } from "../../shared/csv";

interface CsvColumn {
  key: string;
  label: string;
}

export interface CsvTable {
  columns: CsvColumn[];
  rows: Record<string, unknown>[];
}

/** Values a chart can hand to its CSV button: a table, or a lazy builder. */
export type CsvSource = CsvTable | (() => CsvTable | null) | null | undefined;

/** Numbers land in the file with a dot separator and no float noise. */
export function csvNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

export function toCsv(table: CsvTable): string {
  const lines = [table.columns.map((column) => csvField(column.label)).join(",")];
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvField(row[column.key])).join(","));
  }
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
