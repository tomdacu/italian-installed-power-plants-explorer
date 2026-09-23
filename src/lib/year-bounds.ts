import { DATA_FIRST_YEAR } from "./constants";
import type { MetadataOptions } from "../../shared/types";

/**
 * I limiti d'anno che la pagina Sync e il pannello filtri derivano allo stesso
 * modo dal metadata del server: le due schermate propongono lo stesso
 * intervallo, quindi le tre regole che erano ripetute si calcolano qui.
 *
 * Restano nei punti d'uso le differenze reali: il primo anno *per-dataset* del
 * nazionale (che solo il pannello filtri conosce), il massimo cross-dataset
 * (`availability` per la pagina Sync, `database.years` per il pannello: fonti
 * diverse, quindi due riduzioni diverse) e il clamp dei due campi digitati
 * (solo la pagina Sync, con i limiti di `clampYears` del server).
 */
export interface YearWindow {
  /** Primo anno che Terna pubblica: il metadata, altrimenti il pavimento condiviso col server. */
  firstYear: number;
  /** Anno corrente: quello del metadata, altrimenti l'orologio locale (SPA senza server). */
  currentYear: number;
  /**
   * Ultimo anno proponibile quando la cache non sa nulla: l'anno scorso.
   * L'anno corrente non è ancora uscito, e proporlo accoderebbe solo passi con
   * niente da scaricare.
   */
  fallbackLastYear: number;
}

export function resolveYearWindow(meta?: Pick<MetadataOptions, "first_year" | "current_year">): YearWindow {
  const currentYear = meta?.current_year ?? new Date().getFullYear();
  return {
    firstYear: meta?.first_year ?? DATA_FIRST_YEAR,
    currentYear,
    fallbackLastYear: currentYear - 1,
  };
}
