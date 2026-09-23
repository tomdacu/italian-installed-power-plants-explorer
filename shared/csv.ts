/**
 * Serializzazione CSV condivisa fra l'export del server (`server/db.ts`) e i
 * pulsanti CSV dei grafici (`src/lib/csv.ts`): le due copie erano già
 * comportamentalmente identiche, quindi la cella si formatta qui una volta sola
 * e i due export non possono più divergere.
 */

/**
 * BOM UTF-8 in testa al file: senza, Excel su Windows legge i toponimi
 * accentati ("Forlì-Cesena", "Vallée d'Aoste") come mojibake.
 */
export const CSV_BOM = "\uFEFF";

/**
 * Una cella CSV: virgolette solo quando servono (virgola, virgoletta, a capo),
 * altrimenti il valore nudo.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Un numero finito è già testo innocuo: `String(-6.4)` è "-6.4", e l'apice
  // anti-formula lo corromperebbe ("'-6.4" non è più un numero per Excel, che
  // smetteva di sommare la colonna). I delta negativi dei grafici di addizioni
  // sono numeri, quindi questo caso va prima della regex — non dopo. `NaN` e
  // `Infinity` non passano di qui: non iniziano con un carattere di formula e
  // restano stringhe normali.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value);
  // Formula injection (CWE-1236): Excel esegue una cella che inizia con `=`,
  // `+`, `-`, `@`, tab o CR, e il BOM che prepariamo per gli accenti non
  // disinnesca nulla. L'apice la rende testo; se il campo contiene anche
  // virgolette, virgole o a capo, la quotatura normale viene dopo.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
