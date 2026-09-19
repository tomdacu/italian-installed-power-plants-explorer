/**
 * Costanti di dominio: gli stessi valori che l'API Terna accetta davvero.
 * Fuori dai dataset validi l'API risponde con un corpo vuoto (non un errore),
 * quindi il piano di sync interseca sempre le richieste con queste liste.
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

/** `/installed-capacity` serve solo l'anno corrente e i 6 precedenti. */
export const INSTALLED_CAPACITY_YEAR_WINDOW = 7;
