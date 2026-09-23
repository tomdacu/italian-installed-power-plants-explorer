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

test("un numero negativo resta un numero, senza apice", () => {
  const csv = toCsv({
    columns: [
      { key: "year", label: "year" },
      { key: "value", label: "value" },
    ],
    rows: [{ year: 2019, value: -6.4 }],
  });

  // `-6.4` inizia con `-` come una formula: l'apice lo renderebbe testo e
  // Excel non lo sommerebbe più. Il caso reale è il delta negativo.
  expect(csv).toContain("2019,-6.4");
  expect(csv).not.toContain("'-6.4");
});

test("i delta negativi dei grafici di addizioni escono leggibili", () => {
  // Serie reale in calo (Bioenergie 2019: −60.655 MW): è il caso che l'apice
  // applicato alle stringhe corrompeva in ogni export.
  const declining: YearlySplit = {
    ...split,
    data: [
      { year: 2018, Bioenergie: 1120.655 },
      { year: 2019, Bioenergie: 1060 },
    ],
    names: ["Bioenergie"],
  };

  const growth = yearlyAdditions(declining);
  const csv = growth ? toCsv(additionsCsv(growth, "source")) : "";

  expect(csv).toContain("2019,Bioenergie,-60.655");
  expect(csv).not.toContain("'-60.655");
});

test("le celle che iniziano con una formula non escono eseguibili", () => {
  const csv = toCsv({
    columns: [
      { key: "source", label: "source" },
      { key: "value", label: "value" },
    ],
    rows: [
      { source: '=HYPERLINK("http://evil")', value: 1 },
      { source: "+1+cmd", value: 2 },
      { source: "@SUM(1)", value: 3 },
      { source: "=cmd|'/c calc'!A0", value: 4 },
      { source: "-6.4", value: -6.4 },
      { source: "Fotovoltaico", value: 5 },
    ],
  });

  // Excel eseguirebbe queste celle: l'apice le rende testo (e la quotatura
  // normale resta al suo posto per la virgoletta interna).
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  expect(csv).toContain("'+1+cmd");
  expect(csv).toContain("'@SUM(1)");
  // I campi normali non guadagnano l'apice.
  expect(csv).toContain("Fotovoltaico");
  expect(csv).not.toContain("'Fotovoltaico");
});
