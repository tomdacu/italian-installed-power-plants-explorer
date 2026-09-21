/**
 * CSV serialization for the chart export buttons.
 *
 * Mirrors the server-side exporter (`server/db.ts`): fields are quoted only when
 * they carry a comma, a quote or a newline, rows are CRLF-terminated and the
 * payload opens with a UTF-8 BOM so Excel on Windows reads accented place names
 * ("Forlì-Cesena", "Vallée d'Aoste") instead of mojibake.
 */

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

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table: CsvTable): string {
  const lines = [table.columns.map((column) => csvField(column.label)).join(",")];
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvField(row[column.key])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
