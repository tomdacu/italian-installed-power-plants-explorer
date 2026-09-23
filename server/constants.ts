/**
 * Costanti di dominio: gli stessi valori che l'API Terna pubblica. Il sync non
 * filtra più per fonte o indice (una richiesta per dataset e anno restituisce
 * tutto), quindi queste liste servono alla UI: etichette, menu dei filtri e
 * colori delle serie.
 */
import type { DatasetName } from "../shared/types";

export const RENEWABLE_SOURCES = [
  "Bioenergie",
  "Eolico",
  "Fotovoltaico",
  "Geotermoelettrico",
  "Idrico",
] as const;

export const GENERATION_PLANT_SOURCES = [
  "Eolico",
  "Fotovoltaico",
  "Geotermoelettrico",
  "Idrico",
  "Termoelettrico",
  // Accumuli stand-alone: compaiono solo in questo dataset e solo dal 2023.
  "Accumulo stand alone",
] as const;

export const INSTALLED_CAPACITY_TYPES = [
  "Thermal",
  "Wind",
  "Geothermal",
  "Photovoltaic",
  "Hydro",
] as const;

export const DATASET_SOURCES: Record<DatasetName, readonly string[]> = {
  renewable_source_capacity: RENEWABLE_SOURCES,
  generation_plants: GENERATION_PLANT_SOURCES,
  installed_capacity: [],
  thermoelectric_capacity: [],
};

/** Indice singolo usato dai totali: Lorda e Netta non si sommano mai. */
export const DEFAULT_CAPACITY_TYPE = "Lorda" as const;

/** Righe restituite da `/records` quando il client non chiede una pagina. */
export const DEFAULT_RECORD_LIMIT = 5000;

/**
 * Primo anno pubblicato dagli endpoint della generazione. Verificato con le
 * chiavi reali: `renewable-source-capacity` risponde con 832 righe per il 2000
 * e con un 406 per il 1999; la documentazione Terna dice la stessa cosa
 * ("data are represented by region and province from 2000 onwards").
 */
export const DATA_FIRST_YEAR = 2000;

/**
 * `/installed-capacity` è più giovane: rifiuta con un 406 tutto ciò che precede
 * il 2021 (verificato: 2020 → errore di validazione, 2021 → 5 righe).
 */
export const INSTALLED_CAPACITY_FIRST_YEAR = 2021;

/** Le annualità future non esistono ancora: l'ultimo anno possibile è l'attuale. */
export function currentYear(now: Date = new Date()): number {
  return now.getFullYear();
}

/** Primo anno disponibile per dataset. */
export function firstYearFor(dataset: DatasetName): number {
  return dataset === "installed_capacity" ? INSTALLED_CAPACITY_FIRST_YEAR : DATA_FIRST_YEAR;
}

/**
 * Tiene solo gli anni che Terna può davvero servire (limiti inferiori per
 * dataset, anno corrente come tetto), ordinati e senza duplicati. L'API e la UI
 * usano questa stessa funzione, così il range mostrato e quello scaricato non
 * possono divergere.
 *
 * `skipped` conta solo gli anni che Terna non può servire. La deduplica è
 * silenziosa: un anno ripetuto non è un passo mai eseguito, quindi non gonfia
 * il conteggio (prima `years.length - kept.length` contava anche i duplicati e
 * il job dichiarava passi saltati che non esistevano).
 */
export function clampYears(years: number[], now: Date = new Date()): { years: number[]; skipped: number } {
  const ceiling = currentYear(now);
  const requested = [...new Set(years)];
  const kept = requested
    .filter((year) => Number.isInteger(year) && year >= DATA_FIRST_YEAR && year <= ceiling)
    .sort((a, b) => a - b);
  return { years: kept, skipped: requested.length - kept.length };
}
