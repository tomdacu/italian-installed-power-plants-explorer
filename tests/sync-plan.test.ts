import { expect, test } from "bun:test";

import { DATA_FIRST_YEAR, INSTALLED_CAPACITY_FIRST_YEAR, clampYears, currentYear } from "../server/constants.ts";
import { buildPlan, SyncManager } from "../server/sync.ts";
import type { CapacityStore } from "../server/db.ts";
import type { TernaClient } from "../server/terna.ts";
import type { SyncJobStatus } from "../shared/types.ts";

test("una richiesta per dataset e anno", () => {
  const { steps, dropped } = buildPlan({
    years: [2023, 2024],
    datasets: ["renewable_source_capacity", "generation_plants", "installed_capacity", "thermoelectric_capacity"],
  });

  // `installed_capacity` non serve il 2023 né il 2024: quei passi non esistono.
  expect(dropped).toBe(0);
  expect(steps).toHaveLength(2 * 4);
  expect(steps.map((step) => step.label)).toContain("Renewable capacity 2023");
});

test("gli anni che un dataset non pubblica vengono saltati, non richiesti", () => {
  const { steps, dropped } = buildPlan({
    years: [2010, 2022],
    datasets: ["renewable_source_capacity", "installed_capacity"],
  });

  // 2010: solo le rinnovabili; 2022: entrambi. Il 2010 di installed_capacity
  // sarebbe un 406 (verificato sull'API), quindi non entra nel piano.
  expect(steps.map((step) => `${step.dataset} ${step.year}`)).toEqual([
    "renewable_source_capacity 2010",
    "renewable_source_capacity 2022",
    "installed_capacity 2022",
  ]);
  expect(dropped).toBe(1);
});

test("il piano completo parte dal primo anno pubblicato", () => {
  const years = Array.from({ length: currentYear() - DATA_FIRST_YEAR + 1 }, (_, i) => DATA_FIRST_YEAR + i);
  const { steps, dropped } = buildPlan({
    years,
    datasets: ["renewable_source_capacity", "generation_plants", "installed_capacity", "thermoelectric_capacity"],
  });

  const installedYears = steps.filter((step) => step.dataset === "installed_capacity").map((step) => step.year);
  expect(installedYears[0]).toBe(INSTALLED_CAPACITY_FIRST_YEAR);
  // Tre dataset coprono tutti gli anni, il quarto parte dal 2021.
  expect(steps).toHaveLength(years.length * 3 + installedYears.length);
  expect(dropped).toBe(INSTALLED_CAPACITY_FIRST_YEAR - DATA_FIRST_YEAR);
});

test("clampYears tiene solo gli anni che Terna può servire", () => {
  const { years, skipped } = clampYears([1899, 2000, 2024, 2024, 2100]);

  expect(years).toEqual([2000, 2024]);
  expect(skipped).toBe(3); // 1899, il duplicato 2024 e il 2100
  expect(clampYears([]).years).toEqual([]);
});

/**
 * Aspetta la fine del job senza orologio: la catena di `run` è fatta di
 * microtask (gli stub risolvono subito), quindi basta cedere il turno finché
 * lo stato non è terminale. Nessuna durata da indovinare.
 */
async function settle(sync: SyncManager, id: string): Promise<SyncJobStatus> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const status = sync.status(id);
    if (status && status.status !== "running" && status.status !== "queued") return status;
    await Promise.resolve();
  }
  throw new Error("il job non è mai finito");
}

test("un payload Terna inatteso fallisce il passo invece di apparire vuoto", async () => {
  let writes = 0;
  const store = {
    replaceSnapshot() { writes += 1; return 0; },
  } as unknown as CapacityStore;
  const client = {
    renewableSourceCapacity: async () => ({ error: "unexpected response" }),
  } as unknown as TernaClient;
  const sync = new SyncManager(store, async () => client);
  const id = sync.start(buildPlan({ years: [2024], datasets: ["renewable_source_capacity"] }));
  expect(sync.latestStatus()?.job_id).toBe(id);

  // L'unico passo è fallito: il job è `failed` con la causa, non un
  // "completed" che nasconde il buco nei dati.
  const status = await settle(sync, id);
  expect(status).toMatchObject({ status: "failed", failed_steps: 1, empty_steps: 0, completed_steps: 1, total_steps: 1 });
  expect(status.error).toContain("Unexpected Terna response");
  // Il messaggio parte dal conteggio e non afferma un successo: la regex di
  // `useSyncJob` non lo scarta e la causa arriva fino all'interfaccia.
  expect(status.message).toMatch(/^All 1 of 1 steps failed/);
  expect(status.message).not.toMatch(/^sync (?:completed|finished|succeeded)\b/i);
  expect(status.message).toContain("Unexpected Terna response");
  expect(writes).toBe(0);
});

test("un job misto resta completed ma dice quanti passi sono caduti", async () => {
  const store = {
    replaceSnapshot() { return 0; },
  } as unknown as CapacityStore;
  const client = {
    renewableSourceCapacity: async () => ({}),
    generationPlants: async () => { throw new Error("503 from Terna"); },
  } as unknown as TernaClient;
  const sync = new SyncManager(store, async () => client);
  const id = sync.start(
    buildPlan({ years: [2024], datasets: ["renewable_source_capacity", "generation_plants"] }),
  );

  const status = await settle(sync, id);
  expect(status.status).toBe("completed");
  expect(status.failed_steps).toBe(1);
  expect(status.message).toMatch(/^1 of 2 steps failed/);
  expect(status.message).toContain("503 from Terna");
  expect(status.message).not.toMatch(/^sync (?:completed|finished|succeeded)\b/i);
  expect(status.error).toBeNull();
});

test("un job senza errori resta il messaggio di sempre", async () => {
  const store = {
    replaceSnapshot() { return 0; },
  } as unknown as CapacityStore;
  const client = {
    renewableSourceCapacity: async () => ({}),
    generationPlants: async () => ({}),
  } as unknown as TernaClient;
  const sync = new SyncManager(store, async () => client);
  const id = sync.start(
    buildPlan({ years: [2024], datasets: ["renewable_source_capacity", "generation_plants"] }),
  );

  const status = await settle(sync, id);
  expect(status).toMatchObject({ status: "completed", message: "Sync completed", failed_steps: 0, error: null });
});

