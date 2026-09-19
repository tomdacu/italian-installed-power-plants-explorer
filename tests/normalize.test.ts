import { describe, expect, test } from "bun:test";

import {
  generationPlantsRows,
  installedCapacityRows,
  parseDecimal,
  renewableSourceCapacityRows,
  thermoelectricCapacityRows,
} from "../server/normalize.ts";

describe("parseDecimal", () => {
  test("virgola come separatore decimale", () => {
    expect(parseDecimal("14,243")).toBe(14.243);
  });

  test("migliaia con entrambi i separatori", () => {
    expect(parseDecimal("1.234,50")).toBe(1234.5);
  });

  test("punto singolo = decimale (payload /installed-capacity)", () => {
    expect(parseDecimal("59.7902")).toBe(59.7902);
    expect(parseDecimal("22.8")).toBe(22.8);
  });

  test("più punti senza virgola = migliaia", () => {
    expect(parseDecimal("1.234.567")).toBe(1234567);
  });

  test("valori non numerici e vuoti", () => {
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("n/d")).toBeNull();
    expect(parseDecimal(42.5)).toBe(42.5);
  });
});

test("renewable rows normalizzano il payload", () => {
  const payload = {
    renewable_sources: [
      {
        year: "2023",
        capacity_type: "Lorda",
        region: "Abruzzo",
        province: "Chieti",
        source: "Bioenergie",
        efficient_power_MW: "14,243",
      },
    ],
  };

  expect(renewableSourceCapacityRows(payload, "2026-01-01T00:00:00+00:00")).toEqual([
    {
      dataset: "renewable_source_capacity",
      year: 2023,
      capacity_type: "Lorda",
      region: "Abruzzo",
      province: "Chieti",
      source: "Bioenergie",
      category: null,
      subcategory: null,
      type: null,
      efficient_power_mw: 14.243,
      installed_capacity_gw: null,
      fetched_at: "2026-01-01T00:00:00+00:00",
    },
  ]);
});

test("installed capacity conserva la scala dei numeri con il punto", () => {
  const payload = {
    installed_capacity: [
      { year: "2022", type: "Hydro", installed_capacity_GWh: "22.8" },
      { year: "2021", type: "Thermal", installed_capacity_GWh: "59.7902" },
    ],
  };

  const rows = installedCapacityRows(payload, "2026-01-01T00:00:00+00:00");
  expect(rows.map((row) => row.installed_capacity_gw)).toEqual([22.8, 59.7902]);
  expect(rows.every((row) => row.efficient_power_mw === null)).toBe(true);
});

test("generation plants e termoelettrico mappano i campi attesi", () => {
  const plants = generationPlantsRows(
    { generation_plants: [{ year: 2024, source: "Idrico", efficient_power_MW: 161.79 }] },
    "2026-01-01T00:00:00+00:00",
  );
  expect(plants[0].source).toBe("Idrico");
  expect(plants[0].efficient_power_mw).toBe(161.79);

  const thermo = thermoelectricCapacityRows(
    {
      thermoelectric: [
        { year: 2024, category: "Cogenerative", subcategory: "Ciclo combinato", efficient_power_MW: 887.6 },
      ],
    },
    "2026-01-01T00:00:00+00:00",
  );
  expect(thermo[0].source).toBe("Termoelettrico");
  expect(thermo[0].category).toBe("Cogenerative");
  expect(thermo[0].efficient_power_mw).toBe(887.6);
});

test("payload vuoto o assente produce zero righe, non un errore", () => {
  expect(renewableSourceCapacityRows({})).toEqual([]);
  expect(installedCapacityRows({ installed_capacity: [] })).toEqual([]);
});
