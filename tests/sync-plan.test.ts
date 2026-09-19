import { expect, test } from "bun:test";

import { GENERATION_PLANT_SOURCES, INSTALLED_CAPACITY_TYPES, RENEWABLE_SOURCES } from "../server/constants.ts";
import { buildPlan } from "../server/sync.ts";

test("il numero di passi corrisponde all'esecuzione", () => {
  const { steps, dropped } = buildPlan({
    years: [2023, 2024],
    datasets: ["renewable_source_capacity"],
    sources: ["Fotovoltaico", "Eolico"],
    capacity_types: ["Lorda", "Netta"],
  });

  expect(dropped).toBe(0);
  expect(steps).toHaveLength(2 * 2 * 2);
});

test("generation plants scarta Bioenergie senza far fallire il job", () => {
  const { steps, dropped } = buildPlan({
    years: [2024],
    datasets: ["generation_plants"],
    sources: ["Fotovoltaico", "Bioenergie"],
    capacity_types: ["Lorda"],
  });

  const sources = steps.map((step) => step.source);
  expect(sources.every((source) => source === undefined || GENERATION_PLANT_SOURCES.includes(source as never))).toBe(true);
  expect(sources).not.toContain("Bioenergie");
  expect(dropped).toBe(1);
});

test("il piano completo resta sotto le 300 richieste", () => {
  const { steps } = buildPlan({
    years: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
    datasets: [
      "renewable_source_capacity",
      "generation_plants",
      "installed_capacity",
      "thermoelectric_capacity",
    ],
    sources: [...new Set([...RENEWABLE_SOURCES, "Termoelettrico"])],
    capacity_types: ["Lorda", "Netta"],
  });

  const expected =
    7 * RENEWABLE_SOURCES.length * 2 +
    7 * GENERATION_PLANT_SOURCES.length * 2 +
    7 * INSTALLED_CAPACITY_TYPES.length +
    7 * 2;
  expect(steps).toHaveLength(expected);
  expect(steps.length).toBeLessThan(300);
});

test("i tipi di capacità non validi vengono scartati, non spediti", () => {
  const { steps, dropped } = buildPlan({
    years: [2024],
    datasets: ["thermoelectric_capacity"],
    capacity_types: ["Lorda", "Inesistente"],
  });

  expect(steps).toHaveLength(1);
  expect(dropped).toBe(1);
});
