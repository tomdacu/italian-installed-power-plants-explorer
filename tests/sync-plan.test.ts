import { expect, test } from "bun:test";

import { DATA_FIRST_YEAR, INSTALLED_CAPACITY_FIRST_YEAR, clampYears, currentYear } from "../server/constants.ts";
import { buildPlan } from "../server/sync.ts";

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
