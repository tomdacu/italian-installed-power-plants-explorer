import type { DatasetName } from "@/types";

export const ONBOARDING_KEY = "terna.onboarded";

/** I dataset che la SPA sincronizza: usati come default e dal pulsante Download. */
export const ALL_DATASETS: DatasetName[] = [
  "renewable_source_capacity",
  "generation_plants",
  "installed_capacity",
  "thermoelectric_capacity",
];
