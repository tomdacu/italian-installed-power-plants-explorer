import { expect, test } from "bun:test";

import { buildPlan } from "../server/sync.ts";

test("una richiesta per dataset e anno", () => {
  const { steps, dropped } = buildPlan({
    years: [2023, 2024],
    datasets: ["renewable_source_capacity", "generation_plants", "installed_capacity", "thermoelectric_capacity"],
    sources: [],
    capacity_types: [],
  });

  expect(dropped).toBe(0);
  expect(steps).toHaveLength(2 * 4);
  expect(steps.map((step) => step.label)).toContain("Renewable capacity 2023");
});

test("il piano copre gli anni richiesti e ignora i dataset non sincronizzabili", () => {
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
  const { steps } = buildPlan({
    years,
    datasets: ["renewable_source_capacity", "generation_plants", "installed_capacity", "thermoelectric_capacity"],
    sources: [],
    capacity_types: [],
  });

  // Sette anni per dataset, non sette anni × fonti × indici: è la riduzione che
  // tiene il sync lontano dal limite di richieste di Terna.
  expect(steps).toHaveLength(years.length * 4);
  expect(steps.every((step) => years.includes(step.year))).toBe(true);
  expect(steps.some((step) => step.dataset === "renewable_source_capacity")).toBe(true);
});

test("la richiesta non dipende più da fonti e indici scelti dall'utente", () => {
  const withFilters = buildPlan({
    years: [2023],
    datasets: ["renewable_source_capacity"],
    sources: ["Fotovoltaico"],
    capacity_types: ["Lorda"],
  });
  const withoutFilters = buildPlan({
    years: [2023],
    datasets: ["renewable_source_capacity"],
    sources: [],
    capacity_types: [],
  });

  expect(withFilters.steps).toEqual(withoutFilters.steps);
});
