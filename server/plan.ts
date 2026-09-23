/**
 * Il piano di un job di sync: quali dataset, quali anni, in che ordine.
 *
 * È la parte **pura** della pianificazione — nessuno stato, nessuna rete,
 * nessuna cache — quindi si prova senza costruire un manager. La macchina a
 * stati che lo esegue resta in `sync.ts`.
 */
import { firstYearFor } from "./constants.ts";
import { DATASETS, type DatasetName, type SyncRequestPayload } from "../shared/types.ts";

/**
 * I dataset che un job può eseguire, nell'ordine in cui li pianifica. È lo
 * stesso array di `DATASETS` (`shared/types.ts`), non una seconda lista da
 * tenere allineata a mano: le due copie potevano divergere in silenzio e un
 * dataset nuovo non entrava nel sync. L'API li usa per contare i passi saltati
 * di un anno limato: un anno fuori intervallo è un passo mai eseguito **per
 * ciascun dataset**, non uno solo.
 */
export const SYNCABLE_DATASETS: readonly DatasetName[] = DATASETS;

export interface SyncStep {
  label: string;
  dataset: DatasetName;
  year: number;
}

/** Il piano di un job: i passi da eseguire e gli anni che nessun dataset pubblica. */
export interface SyncPlan {
  steps: SyncStep[];
  dropped: number;
}

/**
 * Un solo passo per dataset e anno: Terna restituisce in una risposta tutte le
 * fonti e tutti gli indici (verificato sul payload reale — `renewable-source-capacity`
 * 2023 senza filtri torna 1.160 righe, `thermoelectric-capacity` 1.192). Il
 * vecchio piano chiedeva anno × fonte × indice, cioè 27 richieste per anno, ed
 * è così che si finiva contro il limite di richieste dell'API.
 *
 * Gli anni che un dataset non può servire vengono saltati e contati in
 * `dropped`: `/installed-capacity` rifiuta tutto ciò che precede il 2021.
 */
export function buildPlan(request: SyncRequestPayload): SyncPlan {
  const steps: SyncStep[] = [];
  const datasets = (request.datasets ?? [...SYNCABLE_DATASETS]).filter((dataset) =>
    SYNCABLE_DATASETS.includes(dataset),
  );
  const labels: Record<string, string> = {
    renewable_source_capacity: "Renewable capacity",
    generation_plants: "Generation plants",
    installed_capacity: "Installed capacity (national)",
    thermoelectric_capacity: "Thermoelectric capacity",
  };
  let dropped = 0;

  for (const year of request.years) {
    for (const dataset of datasets) {
      if (year < firstYearFor(dataset)) {
        dropped += 1;
        continue;
      }
      steps.push({ label: `${labels[dataset]} ${year}`, dataset, year });
    }
  }

  return { steps, dropped };
}
