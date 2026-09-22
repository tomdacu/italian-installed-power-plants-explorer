/**
 * Pianificazione ed esecuzione dei job di sync.
 * Porting fedele di `backend/src/terna_backend/sync.py`: il piano si costruisce
 * prima dell'esecuzione (così il totale dei passi è sempre esatto) e un passo
 * fallito non interrompe il job.
 */
import {
  generationPlantsRows,
  installedCapacityRows,
  renewableSourceCapacityRows,
  thermoelectricCapacityRows,
  type CapacityRow,
} from "./normalize.ts";
import { firstYearFor } from "./constants.ts";
import type { CapacityStore } from "./db.ts";
import { TernaClient } from "./terna.ts";
import type { DatasetName, SyncJobStatus, SyncRequestPayload, SyncStatus } from "../shared/types.ts";

const SYNCABLE_DATASETS: readonly DatasetName[] = [
  "renewable_source_capacity",
  "generation_plants",
  "installed_capacity",
  "thermoelectric_capacity",
];

export interface SyncStep {
  label: string;
  dataset: DatasetName;
  year: number;
}

interface JobState {
  jobId: string;
  status: SyncStatus;
  totalSteps: number;
  completedSteps: number;
  message: string;
  error: string | null;
  failedSteps: number;
  emptySteps: number;
  /** Passi mai eseguiti perché quel dataset non pubblica quell'anno. */
  skippedSteps: number;
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

export class SyncManager {
  private readonly jobs = new Map<string, JobState>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: CapacityStore,
    private readonly clientFactory: () => Promise<TernaClient>,
  ) {}

  /**
   * Il piano arriva già costruito: chi deve rifiutare una richiesta (nessun
   * passo eseguibile) lo scopre **prima** che il job esista nella mappa, così
   * un 422 non lascia dietro di sé un job mai eseguito.
   */
  start(plan: SyncPlan): string {
    const jobId = crypto.randomUUID();
    const { steps, dropped } = plan;
    // Un job completato serve solo a rispondere al polling dell'interfaccia:
    // oltre venti, i più vecchi non servono più a nessuno.
    if (this.jobs.size >= 20) {
      const oldest = [...this.jobs.entries()].find(([, state]) => state.status === "completed" || state.status === "failed");
      if (oldest) this.jobs.delete(oldest[0]);
    }
    this.jobs.set(jobId, {
      jobId,
      status: "queued",
      totalSteps: steps.length,
      completedSteps: 0,
      message: "Queued",
      error: null,
      failedSteps: 0,
      emptySteps: 0,
      skippedSteps: dropped,
    });
    // La coda non deve poter restare bloccata: `run` gestisce già i propri
    // errori, questo è il paracadute perché un job non fermi tutti i successivi.
    this.queue = this.queue.then(() => this.run(jobId, steps)).catch(() => undefined);
    return jobId;
  }

  status(jobId: string): SyncJobStatus | null {
    const state = this.jobs.get(jobId);
    if (!state) return null;
    return {
      job_id: state.jobId,
      status: state.status,
      total_steps: state.totalSteps,
      completed_steps: state.completedSteps,
      message: state.message,
      error: state.error,
      failed_steps: state.failedSteps,
      empty_steps: state.emptySteps,
      skipped_steps: state.skippedSteps,
    };
  }

  latestStatus(): SyncJobStatus | null {
    const ids = [...this.jobs.keys()].reverse();
    const active = ids.find((id) => this.jobs.get(id)?.status === "running")
      ?? ids.find((id) => this.jobs.get(id)?.status === "queued");
    return this.status(active ?? ids[0] ?? "");
  }

  private update(jobId: string, patch: Partial<JobState>): void {
    const state = this.jobs.get(jobId);
    if (state) Object.assign(state, patch);
  }

  private async run(jobId: string, steps: SyncStep[]): Promise<void> {
    this.update(jobId, { status: "running", message: "Connecting to Terna" });
    try {
      const client = await this.clientFactory();
      for (const step of steps) {
        this.update(jobId, { message: step.label });
        await this.runStep(jobId, client, step);
      }
      this.update(jobId, { status: "completed", message: "Sync completed" });
    } catch (error) {
      this.update(jobId, {
        status: "failed",
        message: "Sync failed",
        error: (error as Error).message,
      });
    }
  }

  private async runStep(jobId: string, client: TernaClient, step: SyncStep): Promise<void> {
    let stored: number;
    try {
      // Anche la scrittura sta nel try: un errore del database su un passo non
      // deve far cadere l'intero job (gli altri passi restano utili).
      const rows = await this.fetchStep(client, step);
      stored = this.store.replaceSnapshot(step.dataset, step.year, rows);
    } catch (error) {
      const state = this.jobs.get(jobId);
      if (state) {
        state.failedSteps += 1;
        state.completedSteps += 1;
        state.message = `${step.label}: ${(error as Error).message}`;
      }
      return;
    }
    const state = this.jobs.get(jobId);
    if (!state) return;
    state.completedSteps += 1;
    if (stored === 0) state.emptySteps += 1;
  }

  /** Una richiesta per passo: l'endpoint torna già tutte le fonti e gli indici. */
  private async fetchStep(client: TernaClient, step: SyncStep): Promise<CapacityRow[]> {
    const normalize = (
      payload: Record<string, unknown>,
      key: string,
      convert: (data: Record<string, unknown>) => CapacityRow[],
    ): CapacityRow[] => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(`Unexpected Terna response for ${step.label}`);
      }
      if (Object.keys(payload).length === 0) return [];
      if (!Array.isArray(payload[key])) {
        throw new Error(`Unexpected Terna response for ${step.label}: missing ${key} array`);
      }
      return convert(payload);
    };
    if (step.dataset === "renewable_source_capacity") {
      return normalize(
        await client.renewableSourceCapacity({ year: step.year }),
        "renewable_sources",
        renewableSourceCapacityRows,
      );
    }
    if (step.dataset === "generation_plants") {
      return normalize(
        await client.generationPlants({ year: step.year }),
        "generation_plants",
        generationPlantsRows,
      );
    }
    if (step.dataset === "installed_capacity") {
      return normalize(
        await client.installedCapacity({ year: step.year }),
        "installed_capacity",
        installedCapacityRows,
      );
    }
    return normalize(
      await client.thermoelectricCapacity({ year: step.year }),
      "thermoelectric",
      thermoelectricCapacityRows,
    );
  }

}
