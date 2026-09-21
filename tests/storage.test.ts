import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { cleanupTempDirs, tempDir } from "./temp.ts";

import { CapacityStore, parseGroupBy } from "../server/db.ts";
import type { CapacityRow } from "../server/normalize.ts";
import type { RecordFilters } from "../shared/types.ts";

const STORES: CapacityStore[] = [];

afterAll(() => {
  // I database vanno chiusi prima: su Windows rimuovere un file aperto è EBUSY.
  for (const open of STORES) {
    try {
      open.close();
    } catch {
      /* già chiuso */
    }
  }
  cleanupTempDirs();
});

const FETCHED = "2026-01-01T00:00:00+00:00";

function row(overrides: Partial<CapacityRow> & { year: number; source: string; efficient_power_mw: number }): CapacityRow {
  return {
    dataset: "renewable_source_capacity",
    capacity_type: "Lorda",
    region: "Lombardia",
    province: "Milano",
    category: null,
    subcategory: null,
    type: null,
    installed_capacity_gw: null,
    fetched_at: FETCHED,
    ...overrides,
  };
}

/** Due anni, due fonti, entrambi gli indici: Lorda 2023 = 30 MW (10+20), 2024 = 40 MW (15+25). */
function seed(store: CapacityStore): void {
  const rows: CapacityRow[] = [];
  for (const [year, fotovoltaico, eolico] of [
    [2023, 10, 20],
    [2024, 15, 25],
  ] as const) {
    for (const [source, mw] of [
      ["Fotovoltaico", fotovoltaico],
      ["Eolico", eolico],
    ] as const) {
      for (const capacityType of ["Lorda", "Netta"] as const) {
        rows.push(row({ year, source, efficient_power_mw: mw, capacity_type: capacityType }));
      }
    }
  }
  store.upsertRecords(rows);
}

function freshStore(): CapacityStore {
  const store = new CapacityStore(join(tempDir("ice-test-"), "cache.sqlite"));
  STORES.push(store);
  return store;
}

describe("parseGroupBy", () => {
  test("accetta compound e il vecchio separatore +", () => {
    expect(parseGroupBy("year,source")).toEqual(["year", "source"]);
    expect(parseGroupBy("year+source")).toEqual(["year", "source"]);
    expect(parseGroupBy("source")).toEqual(["source"]);
  });

  test("rifiuta input arbitrari (niente SQL injection)", () => {
    expect(() => parseGroupBy("year; DROP TABLE x")).toThrow();
    expect(() => parseGroupBy("")).toThrow();
  });
});

describe("CapacityStore", () => {
  let store: CapacityStore;

  beforeEach(() => {
    store = freshStore();
  });

  test("upsert idempotente e aggregazione per regione", () => {
    store.upsertRecords([
      row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 10, province: "Milano" }),
      row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 5, province: "Bergamo" }),
    ]);
    store.upsertRecords([row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 5, province: "Milano" })]);

    const summary = store.summary({ region: "Lombardia", source: "Fotovoltaico" } satisfies RecordFilters);
    const byRegion = store.aggregate({ source: "Fotovoltaico" } satisfies RecordFilters, "region");

    // Il secondo upsert aggiorna Milano (10 → 5): la somma è 5 + 5 di Bergamo.
    expect(summary.row_count).toBe(2);
    expect(summary.latest_total_efficient_power_mw).toBe(10);
    // Il contratto espone tutte le dimensioni: le non raggruppate sono null.
    expect(byRegion).toEqual([
      {
        year: null,
        region: "Lombardia",
        province: null,
        source: null,
        capacity_type: null,
        category: null,
        subcategory: null,
        type: null,
        efficient_power_mw: 10,
        installed_capacity_gw: null,
      },
    ]);
  });

  test("l'aggregato compound riporta le fonti per nome", () => {
    seed(store);
    const rows = store.aggregate({ capacity_type: "Lorda" } satisfies RecordFilters, "year,source");
    const byKey = new Map(rows.map((entry) => [`${entry.year}|${entry.source}`, entry.efficient_power_mw]));

    expect(byKey.get("2023|Eolico")).toBe(20);
    expect(byKey.get("2024|Fotovoltaico")).toBe(15);
    expect(rows.every((entry) => Boolean(entry.source) && entry.source !== "Unknown")).toBe(true);
  });

  test("latest_only non somma mai gli anni", () => {
    seed(store);
    const rows = store.aggregate({ capacity_type: "Lorda" } satisfies RecordFilters, "source", true);
    const bySource = new Map(rows.map((entry) => [entry.source, entry.efficient_power_mw]));

    expect(bySource.get("Fotovoltaico")).toBe(15);
    expect(bySource.get("Eolico")).toBe(25);
  });

  test("il riepilogo usa un indice solo e calcola il delta annuo", () => {
    seed(store);
    const summary = store.summary({} satisfies RecordFilters);

    expect(summary.latest_year).toBe(2024);
    expect(summary.latest_total_efficient_power_mw).toBe(40);
    expect(summary.previous_year).toBe(2023);
    expect(summary.previous_total_efficient_power_mw).toBe(30);
    expect(summary.yoy_new_mw).toBe(10);
    expect(summary.yoy_pct).toBeCloseTo((10 / 30) * 100, 6);
    expect(summary.capacity_type_applied).toBe("Lorda");

    const netta = store.summary({ capacity_type: "Netta" } satisfies RecordFilters);
    expect(netta.capacity_type_applied).toBe("Netta");
    expect(netta.latest_total_efficient_power_mw).toBe(40);
  });

  test("availability riporta righe per anno", () => {
    seed(store);
    const availability = store.availability();
    const dataset = availability.datasets.renewable_source_capacity;

    expect(dataset?.year_min).toBe(2023);
    expect(dataset?.year_max).toBe(2024);
    expect(dataset?.total_rows).toBe(8);
    expect(Object.fromEntries((dataset?.years ?? []).map((year) => [year.year, year.rows]))).toEqual({ 2023: 4, 2024: 4 });
  });

  test("dataQuality segnala i buchi dentro una serie e ignora le celle vuote strutturali", () => {
    // Un buco è una cella vuota *dentro* la serie della stessa chiave:
    // Bergamo/Fotovoltaico ha valori nel 2022 e nel 2024 e nulla nel 2023 → conta.
    // Bergamo/Geotermoelettrico è vuoto in tutti gli anni (la fonte non esiste
    // lì) e Bergamo/Eolico è vuoto prima di iniziare: nessuno dei due è un buco.
    seed(store);
    store.upsertRecords([
      row({ year: 2022, province: "Bergamo", source: "Fotovoltaico", efficient_power_mw: 20 }),
      row({ year: 2023, province: "Bergamo", source: "Fotovoltaico", efficient_power_mw: null as unknown as number }),
      row({ year: 2024, province: "Bergamo", source: "Fotovoltaico", efficient_power_mw: 30 }),
      row({ year: 2024, province: "Bergamo", source: "Eolico", efficient_power_mw: 5 }),
      row({ year: 2023, province: "Bergamo", source: "Eolico", efficient_power_mw: null as unknown as number }),
      row({ year: 2024, province: "Bergamo", source: "Geotermoelettrico", efficient_power_mw: null as unknown as number }),
      row({ year: 2023, province: "Bergamo", source: "Geotermoelettrico", efficient_power_mw: null as unknown as number }),
    ]);

    const years = store.dataQuality({ dataset: "renewable_source_capacity" });
    const byYear = Object.fromEntries(years.map((entry) => [entry.year, entry.missing_values]));

    // Solo il fotovoltaico 2023: l'eolico è vuoto *prima* che la serie inizi.
    expect(byYear[2023]).toBe(1);
    expect(byYear[2024]).toBeUndefined();
  });

  test("risincronizzare senza valore non cancella un valore già acquisito", () => {
    // Terna manda per la stessa chiave una riga piena e una vuota: la riga
    // vuota non deve azzerare quella piena (era la causa dei buchi nel
    // fotovoltaico 2021-2023).
    seed(store);
    store.upsertRecords([row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: null as unknown as number })]);

    const [record] = store.records({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023, source: "Fotovoltaico", capacity_type: "Lorda" });

    expect(record?.efficient_power_mw).toBe(10);
  });

  test("l'export CSV ha intestazione, escaping e tutte le righe filtrate", () => {
    store.upsertRecords([row({ year: 2024, source: 'Idrico "special"', efficient_power_mw: 1.5 })]);
    const csv = store.toCsv({} satisfies RecordFilters);
    const lines = csv.trim().split("\r\n");

    expect(lines[0]).toContain("dataset,year,capacity_type");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Idrico ""special"""');
  });
});
