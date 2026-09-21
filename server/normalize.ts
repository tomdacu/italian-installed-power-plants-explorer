/**
 * Normalizzazione dei payload Terna in righe della tabella `capacity_records`.
 *
 * Porting fedele di `backend/src/terna_backend/normalize.py`: stessa logica,
 * stessi nomi di campo, stessi casi limite già coperti dai test Python.
 */

export interface CapacityRow {
  dataset: string;
  year: number;
  capacity_type: string | null;
  region: string | null;
  province: string | null;
  source: string | null;
  category: string | null;
  subcategory: string | null;
  type: string | null;
  efficient_power_mw: number | null;
  installed_capacity_gw: number | null;
  fetched_at: string;
}

/**
 * Terna non è coerente fra endpoint: la maggior parte dei payload manda numeri
 * JSON, `/installed-capacity` manda stringhe con il punto decimale ("59.7902"),
 * altri endpoint hanno usato la virgola ("14,243"). Trattare ogni punto come
 * separatore delle migliaia gonfiava i valori di 10^decimali (59.7902 → 597902).
 *
 * Regole: con entrambi i separatori vince il più a destra; una sola virgola è
 * decimale; un solo punto è decimale; più punti senza virgola sono migliaia.
 */
export function parseDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).trim().replace(/\u00a0/g, "");
  if (!text) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalSeparator: string | null;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalSeparator = lastDot > lastComma ? "." : ",";
    text = text.replace(decimalSeparator === "." ? "," : ".", "");
  } else if (lastComma >= 0) {
    decimalSeparator = ",";
  } else if ((text.match(/\./g)?.length ?? 0) > 1) {
    decimalSeparator = null;
    text = text.replace(/\./g, "");
  } else {
    decimalSeparator = ".";
  }

  const normalized = (decimalSeparator ? text.replace(decimalSeparator, ".") : text).replace(/\s/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/**
 * Chiave di una riga: due righe con la stessa chiave sono lo stesso dato.
 * La stessa forma è usata dal database per `record_key`, così una sola
 * definizione decide cosa è "la stessa cella".
 */
function rowKeyParts(row: CapacityRow | Record<string, unknown>): string[] {
  const parts = [
    row.dataset,
    row.year,
    row.capacity_type,
    row.region,
    row.province,
    row.source,
    row.category,
    row.subcategory,
    row.type,
  ];
  return parts.map((part) => (part === null || part === undefined ? "" : String(part)));
}

export function rowKey(row: CapacityRow | Record<string, unknown>): string {
  return rowKeyParts(row).join("|");
}

const maxNullable = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);

const sumNullable = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;

/**
 * Come si fondono due righe con la stessa chiave. Non è la stessa cosa per
 * tutti gli endpoint, e l'arbitro è l'annuario Terna pubblicato:
 *
 * - `generation-plants` pubblica una riga per impianto (Modena 2024: 213,193 e
 *   1,001): sono impianti diversi, vanno **sommati** — con il massimo il
 *   termoelettrico 2024 resta 1,5 MW sotto l'annuario;
 * - `thermoelectric-capacity` pubblica per categoria e sottocategoria, e la
 *   stessa riga può comparire due volte identica (Modena «Celle combustibili»
 *   1,0 e 1,0): qui vale **una sola**, altrimenti i totali salgono (erano
 *   1,465 MW sopra l'annuario).
 */
type MergeStrategy = "sum" | "max";

/**
 * Terna emette più righe per la stessa chiave: una con il valore e altre vuote,
 * oppure righe ripetute. Tenere l'ultima — come faceva il salvataggio — buttava
 * via il valore quando ne arrivava una vuota dopo (i buchi nel fotovoltaico
 * 2021-2023). Come fonderle dipende dall'endpoint, vedi `MergeStrategy`.
 */
function mergeDuplicates(rows: CapacityRow[], strategy: MergeStrategy = "max"): CapacityRow[] {
  const combine = strategy === "sum" ? sumNullable : maxNullable;
  const merged = new Map<string, CapacityRow>();
  for (const row of rows) {
    const key = rowKey(row);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.efficient_power_mw = combine(existing.efficient_power_mw, row.efficient_power_mw);
    existing.installed_capacity_gw = combine(existing.installed_capacity_gw, row.installed_capacity_gw);
  }
  return [...merged.values()];
}

function itemRows(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = payload[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

const asText = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

/**
 * Refusi nei file Terna, verificati sul payload reale: due province arrivano
 * con uno zero al posto del trattino (2000-2016) e la Valle d'Aosta compare con
 * due grafie a seconda dell'endpoint. Senza correzione la stessa provincia si
 * presenta due volte nel menu e la sua serie si spezza fra le due voci.
 */
export const PLACE_FIXES: Record<string, string> = {
  Olbia0tempio: "Olbia-Tempio",
  Verbano0cusio0ossola: "Verbano-Cusio-Ossola",
  "Valle d'Aosta": "Valle D'Aosta",
};

/** Nome canonico di regione/provincia: qui e solo qui si correggono i refusi. */
export function canonicalPlace(value: string | null): string | null {
  return value === null ? null : (PLACE_FIXES[value] ?? value);
}

export function renewableSourceCapacityRows(
  payload: Record<string, unknown>,
  fetchedAt = utcNowIso(),
): CapacityRow[] {
  return mergeDuplicates(itemRows(payload, "renewable_sources").map((item) => ({
    dataset: "renewable_source_capacity",
    year: Number(item.year),
    capacity_type: asText(item.capacity_type),
    region: canonicalPlace(asText(item.region)),
    province: canonicalPlace(asText(item.province)),
    source: asText(item.source),
    category: null,
    subcategory: null,
    type: null,
    efficient_power_mw: parseDecimal(item.efficient_power_MW),
    installed_capacity_gw: null,
    fetched_at: fetchedAt,
  })));
}

export function generationPlantsRows(
  payload: Record<string, unknown>,
  fetchedAt = utcNowIso(),
): CapacityRow[] {
  return mergeDuplicates(itemRows(payload, "generation_plants").map((item) => ({
    dataset: "generation_plants",
    year: Number(item.year),
    capacity_type: asText(item.capacity_type),
    region: canonicalPlace(asText(item.region)),
    province: canonicalPlace(asText(item.province)),
    source: asText(item.source),
    category: null,
    subcategory: null,
    type: null,
    efficient_power_mw: parseDecimal(item.efficient_power_MW),
    installed_capacity_gw: null,
    fetched_at: fetchedAt,
  })), "sum");
}

export function installedCapacityRows(
  payload: Record<string, unknown>,
  fetchedAt = utcNowIso(),
): CapacityRow[] {
  return mergeDuplicates(itemRows(payload, "installed_capacity").map((item) => ({
    dataset: "installed_capacity",
    year: Number(item.year),
    capacity_type: null,
    region: null,
    province: null,
    source: null,
    category: null,
    subcategory: null,
    type: asText(item.type),
    efficient_power_mw: null,
    // Il campo si chiama `installed_capacity_GWh` ma contiene GW: non fidarsi
    // del nome, i valori sono gigawatt (59.7902 = 59,7902 GW).
    installed_capacity_gw: parseDecimal(item.installed_capacity_GWh),
    fetched_at: fetchedAt,
  })));
}

export function thermoelectricCapacityRows(
  payload: Record<string, unknown>,
  fetchedAt = utcNowIso(),
): CapacityRow[] {
  return mergeDuplicates(itemRows(payload, "thermoelectric").map((item) => ({
    dataset: "thermoelectric_capacity",
    year: Number(item.year),
    capacity_type: asText(item.capacity_type),
    region: canonicalPlace(asText(item.region)),
    province: canonicalPlace(asText(item.province)),
    source: "Termoelettrico",
    category: asText(item.category),
    subcategory: asText(item.subcategory),
    type: null,
    efficient_power_mw: parseDecimal(item.efficient_power_MW),
    installed_capacity_gw: null,
    fetched_at: fetchedAt,
  })));
}
