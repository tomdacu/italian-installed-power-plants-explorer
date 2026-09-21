import { expect, test } from "bun:test";

import {
  additionsCsv,
  capacityByAreaSourceCsv,
  capacityBySplitCsv,
  sourceMixCsv,
} from "../src/lib/chart-csv.ts";
import { areaSeries, yearlyAdditions, type YearlySplit } from "../src/lib/chart-data.ts";
import { toCsv } from "../src/lib/csv.ts";

const measure = { isGw: false, valueKey: "efficient_power_mw" as const, unit: "MW" as const, format: String };

const split: YearlySplit = {
  splitKey: "source",
  measure,
  data: [
    { year: 2023, Fotovoltaico: 30, Eolico: 10 },
    { year: 2024, Fotovoltaico: 40, Eolico: 10 },
  ],
  names: ["Eolico", "Fotovoltaico"],
};

test("il CSV della miscela porta anno, fonte, valore e BOM", () => {
  const csv = toCsv(sourceMixCsv(split));

  expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM: senza, Excel sbaglia gli accenti
  expect(csv).toContain("year,source,efficient_power_mw,share_percent");
  expect(csv).toContain("2024,Fotovoltaico,40");
});

test("la quota di ogni fonte è calcolata sull'anno", () => {
  const csv = toCsv(sourceMixCsv(split));

  expect(csv).toContain("share_percent");
  expect(csv).toContain("2024,Fotovoltaico,40,80");
  expect(csv).toContain("2024,Eolico,10,20");
});

test("le addizioni saltano gli anni mancanti invece di sommarli", () => {
  const withGap: YearlySplit = {
    ...split,
    data: [
      { year: 2021, Fotovoltaico: 10 },
      { year: 2023, Fotovoltaico: 30 },
      { year: 2024, Fotovoltaico: 40 },
    ],
  };

  const growth = yearlyAdditions(withGap);
  const csv = growth ? toCsv(additionsCsv(growth, "source")) : "";

  // 2021→2023 non è un anno: quel delta pluriennale non deve comparire.
  expect(csv).not.toContain("2023,Fotovoltaico,20");
  expect(csv).toContain("2024,Fotovoltaico,10");
});

test("la ripartizione per area somma le fonti e ne scrive la quota", () => {
  const records = [
    { region: "Toscana", source: "Fotovoltaico", efficient_power_mw: 75 },
    { region: "Toscana", source: "Geotermoelettrico", efficient_power_mw: 25 },
    { region: "Lombardia", source: "Fotovoltaico", efficient_power_mw: 50 },
  ];
  const series = areaSeries(records as never, "region", "source", "efficient_power_mw");
  const csv = toCsv(capacityByAreaSourceCsv(series, "region", "source", false));

  expect(series.rows[0]?.area).toBe("Toscana");
  expect(series.rows[0]?.total).toBe(100);
  expect(csv).toContain("region,source,efficient_power_mw,share_in_area_percent");
  expect(csv).toContain("Toscana,Fotovoltaico,75,75");
  expect(csv).toContain("Toscana,Geotermoelettrico,25,25");
});

test("il CSV per fonte usa i gigawatt quando il dataset è quello nazionale", () => {
  const installed = [{ type: "Photovoltaic", installed_capacity_gw: 37.0021 }];
  const csv = toCsv(capacityBySplitCsv(installed as never, "type", true));

  expect(csv).toContain("type,installed_capacity_gw");
  expect(csv).toContain("Photovoltaic,37.002");
});
