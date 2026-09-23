import { DATASETS, type DatasetName } from "../../shared/types";

export const ONBOARDING_KEY = "terna.onboarded";

/**
 * Primo anno che Terna pubblica: la stessa costante del server
 * (`shared/constants.ts`), così il pavimento dei menu e quello dell'API non
 * possono divergere.
 */
export { DATA_FIRST_YEAR } from "../../shared/constants";

/**
 * I dataset che la SPA sincronizza: usati come default e dal pulsante Download.
 * È lo stesso array di `DATASETS` (`shared/types.ts`), non una seconda lista da
 * tenere allineata a mano: le due copie potevano divergere in silenzio.
 */
export const ALL_DATASETS: readonly DatasetName[] = DATASETS;
