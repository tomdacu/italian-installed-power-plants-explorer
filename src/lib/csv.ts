/**
 * CSV serialization for the chart export buttons.
 *
 * Mirrors the server-side exporter (`server/db.ts`): fields are quoted only when
 * they carry a comma, a quote or a newline, rows are CRLF-terminated and the
 * payload opens with a UTF-8 BOM so Excel on Windows reads accented place names
 * ("Forlì-Cesena", "Vallée d'Aoste") instead of mojibake. As there, a cell that
 * starts with `=`, `+`, `-`, `@`, tab or CR gets an apostrophe: the BOM alone
 * does not stop Excel from running it as a formula.
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
  // Un numero finito è già testo innocuo: `String(-6.4)` è "-6.4", e l'apice
  // anti-formula lo corromperebbe ("'-6.4" non è più un numero per Excel).
  // I delta negativi dei grafici di addizioni sono numeri, quindi questo caso
  // va prima della regex — non dopo. `NaN`/`Infinity` non passano di qui:
  // non iniziano con un carattere di formula e restano stringhe normali.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value);
  // Formula injection (CWE-1236): Excel esegue una cella che inizia con `=`,
  // `+`, `-`, `@`, tab o CR, e il BOM che prepariamo per gli accenti non
  // disinnesca nulla. L'apice la rende testo; se il campo contiene anche
  // virgolette, virgole o a capo, la quotatura normale viene dopo.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(table: CsvTable): string {
  const lines = [table.columns.map((column) => csvField(column.label)).join(",")];
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvField(row[column.key])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
