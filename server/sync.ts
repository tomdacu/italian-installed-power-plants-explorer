/**
 * Pianificazione ed esecuzione dei job di sync.
 * Porting fedele di `backend/src/terna_backend/sync.py`: il piano si costruisce
 * prima dell'esecuzione (così il totale dei passi è sempre esatto) e un passo
 * fallito non interrompe il job.
 */
import { DATASET_SOURCES, INSTALLED_CAPACITY_TYPES } from "./constants.ts";
import { CAPACITY_TYPES } from "../shared/types.ts";
import {
  generationPlantsRows,
  installedCapacityRows,
  renewableSourceCapacityRows,
  thermoelectricCapacityRows,
  type CapacityRow,
} from "./normalize.ts";
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
  source?: string | null;
  capacity_type?: string | null;
  installed_type?: string | null;
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
}

/** Richieste fuori dalle liste valide producono corpi vuoti: si scartano. */
function effectiveCombos(
  requestedSources: string[],
  requestedTypes: string[],
  validSources: readonly string[],
): { sources: string[]; capacityTypes: string[]; dropped: number } {
  const sourceList = requestedSources.length > 0 ? requestedSources : [...validSources];
  const typeList = requestedTypes.length > 0 ? requestedTypes : [...CAPACITY_TYPES];
  const keptSources = sourceList.filter((source) => validSources.includes(source));
  const keptTypes = typeList.filter((type) => (CAPACITY_TYPES as readonly string[]).includes(type));
  return {
    sources: keptSources,
    capacityTypes: keptTypes,
    dropped: sourceList.length * typeList.length - keptSources.length * keptTypes.length,
  };
}

export function buildPlan(request: SyncRequestPayload): { steps: SyncStep[]; dropped: number } {
  const steps: SyncStep[] = [];
  let dropped = 0;
  const datasets = (request.datasets ?? [...SYNCABLE_DATASETS]).filter((dataset) =>
    SYNCABLE_DATASETS.includes(dataset),
  );
  const sources = request.sources ?? [];
  const types = request.capacity_types ?? [];

  for (const year of request.years) {
    for (const dataset of datasets) {
      if (dataset === "renewable_source_capacity" || dataset === "generation_plants") {
        const combos = effectiveCombos(sources, types, DATASET_SOURCES[dataset]);
        dropped += combos.dropped;
        const label = dataset === "renewable_source_capacity" ? "Renewable capacity" : "Generation plants";
        for (const source of combos.sources) {
          for (const capacityType of combos.capacityTypes) {
            steps.push({ label: `${label} ${year} ${source} ${capacityType}`, dataset, year, source, capacity_type: capacityType });
          }
        }
        continue;
      }

      if (dataset === "installed_capacity") {
        for (const installedType of INSTALLED_CAPACITY_TYPES) {
          steps.push({ label: `Installed capacity ${year} ${installedType}`, dataset, year, installed_type: installedType });
        }
        continue;
      }

      const typeList = types.length > 0 ? types : [...CAPACITY_TYPES];
      const kept = typeList.filter((type) => (CAPACITY_TYPES as readonly string[]).includes(type));
      dropped += typeList.length - kept.length;
      for (const capacityType of kept) {
        steps.push({ label: `Thermoelectric capacity ${year} ${capacityType}`, dataset, year, capacity_type: capacityType });
      }
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

  start(request: SyncRequestPayload): string {
    const jobId = crypto.randomUUID();
    const { steps, dropped } = buildPlan(request);
    this.jobs.set(jobId, {
      jobId,
      status: "queued",
      totalSteps: steps.length,
      completedSteps: 0,
      message: "Queued",
      error: null,
      failedSteps: 0,
      emptySteps: dropped,
    });
    this.queue = this.queue.then(() => this.run(jobId, steps));
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
    };
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
    let rows: CapacityRow[];
    try {
      rows = await this.fetchStep(client, step);
    } catch (error) {
      const state = this.jobs.get(jobId);
      if (state) {
        state.failedSteps += 1;
        state.completedSteps += 1;
        state.message = `${step.label}: ${(error as Error).message}`;
      }
      return;
    }
    const stored = this.store.upsertRecords(rows);
    const state = this.jobs.get(jobId);
    if (!state) return;
    state.completedSteps += 1;
    if (stored === 0) state.emptySteps += 1;
  }

  private async fetchStep(client: TernaClient, step: SyncStep): Promise<CapacityRow[]> {
    if (step.dataset === "renewable_source_capacity") {
      const payload = await client.renewableSourceCapacity({
        year: step.year,
        source: step.source,
        capacity_type: step.capacity_type,
      });
      return renewableSourceCapacityRows(payload);
    }
    if (step.dataset === "generation_plants") {
      const payload = await client.generationPlants({
        year: step.year,
        source: step.source,
        capacity_type: step.capacity_type,
      });
      return generationPlantsRows(payload);
    }
    if (step.dataset === "installed_capacity") {
      const payload = await client.installedCapacity({ year: step.year, type: step.installed_type });
      return installedCapacityRows(payload);
    }
    const payload = await client.thermoelectricCapacity({
      year: step.year,
      capacity_type: step.capacity_type,
    });
    return thermoelectricCapacityRows(payload);
  }
}
