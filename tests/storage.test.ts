import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { cleanupTempDirs, tempDir } from "./temp.ts";

import { CapacityStore, parseGroupBy } from "../server/db.ts";
import { PLACE_FIXES } from "../server/normalize.ts";
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

  test("supporta anche un database SQLite in memoria", () => {
    const memory = new CapacityStore(":memory:");
    expect(memory.countRecords({})).toBe(0);
    memory.close();
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

  test("il riepilogo non presenta un salto pluriennale come variazione annua", () => {
    store.upsertRecords([
      row({ year: 2022, source: "Eolico", efficient_power_mw: 100 }),
      row({ year: 2024, source: "Eolico", efficient_power_mw: 130 }),
    ]);
    const summary = store.summary({ dataset: "renewable_source_capacity" });
    expect(summary.latest_year).toBe(2024);
    expect(summary.previous_year).toBeNull();
    expect(summary.yoy_new_mw).toBeNull();
  });

  test("l'anno precedente deve avere lo stesso indice di capacità", () => {
    store.upsertRecords([
      row({ year: 2023, source: "Eolico", capacity_type: "Netta", efficient_power_mw: 90 }),
      row({ year: 2024, source: "Eolico", capacity_type: "Lorda", efficient_power_mw: 120 }),
    ]);
    const summary = store.summary({ dataset: "renewable_source_capacity" });
    expect(summary.previous_year).toBeNull();
    expect(summary.yoy_new_mw).toBeNull();
  });

  test("una risposta completa elimina le righe ritirate senza toccare altri anni", () => {
    const keep = row({ year: 2024, source: "Eolico", efficient_power_mw: 10 });
    const withdrawn = row({ year: 2024, source: "Fotovoltaico", efficient_power_mw: 20 });
    const otherYear = row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 15 });
    store.upsertRecords([keep, withdrawn, otherYear]);
    store.replaceSnapshot("renewable_source_capacity", 2024, [
      { ...keep, efficient_power_mw: 12 },
    ]);
    expect(store.records({ year_from: 2024, year_to: 2024 }).map((r) => r.source)).toEqual(["Eolico"]);
    expect(store.records({ year_from: 2023, year_to: 2023 })).toHaveLength(1);
    expect(store.summary({ dataset: "renewable_source_capacity" }).latest_total_efficient_power_mw).toBe(12);
  });

  test("una risposta vuota o fuori anno non cancella il dato in cache", () => {
    const existing = row({ year: 2024, source: "Eolico", efficient_power_mw: 10 });
    store.upsertRecords([existing]);
    expect(store.replaceSnapshot("renewable_source_capacity", 2024, [])).toBe(0);
    expect(() => store.replaceSnapshot("renewable_source_capacity", 2024, [{ ...existing, year: 2023 }])).toThrow();
    expect(store.countRecords({ dataset: "renewable_source_capacity" })).toBe(1);
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

  test("repairPlaceNames refreshes the cached options", () => {
    store.upsertRecords([row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 1, province: "Olbia0tempio" })]);
    // The option lists are cached: before the repair they answer with the
    // spelling that is on disk.
    expect(store.options().provinces).toEqual(["Olbia0tempio"]);

    store.repairPlaceNames(PLACE_FIXES);

    // A repair on a running instance must not leave the repaired name out of
    // the menus that were already built.
    expect(store.options().provinces).toEqual(["Olbia-Tempio"]);
  });

  test("repairPlaceNames porta il valore del doppione nella riga canonica", () => {
    // La grafia non canonica ha i valori, quella canonica ha le celle vuote:
    // cancellare il doppione senza fondere le colonne perdeva il dato.
    store.upsertRecords([
      row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 12, installed_capacity_gw: 1.5, province: "Olbia0tempio" }),
      row({
        year: 2023,
        source: "Fotovoltaico",
        efficient_power_mw: null as unknown as number,
        province: "Olbia-Tempio",
      }),
    ]);

    expect(store.repairPlaceNames(PLACE_FIXES)).toBe(1);

    const rows = store.records({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 });
    expect(rows.map((entry) => [entry.province, entry.efficient_power_mw, entry.installed_capacity_gw])).toEqual([
      ["Olbia-Tempio", 12, 1.5],
    ]);
    // Secondo giro: non resta niente da riparare e il valore è ancora lì.
    expect(store.repairPlaceNames(PLACE_FIXES)).toBe(0);
    expect(store.records({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 })).toHaveLength(1);
  });

  test("repairPlaceNames non sovrascrive la riga canonica già valorizzata", () => {
    store.upsertRecords([
      row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 12, province: "Olbia0tempio" }),
      row({ year: 2023, source: "Fotovoltaico", efficient_power_mw: 7, province: "Olbia-Tempio" }),
    ]);

    expect(store.repairPlaceNames(PLACE_FIXES)).toBe(1);

    const [record] = store.records({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 });
    expect(record?.province).toBe("Olbia-Tempio");
    // COALESCE(existente, nuovo): il valore già in cache vince.
    expect(record?.efficient_power_mw).toBe(7);
  });

  test("replaceSnapshot rifiuta un payload parziale invece di bruciare le righe", () => {
    const stored = [1, 2, 3].map((n) => row({ year: 2023, source: `Fonte${n}`, efficient_power_mw: n }));
    store.upsertRecords(stored);

    // Una risposta con un terzo delle righe non è una ritrattazione: il passo
    // deve fallire con i due conteggi e la cache restare intatta.
    expect(() => store.replaceSnapshot("renewable_source_capacity", 2023, [stored[0]!])).toThrow(
      "refusing to replace 2023 with 1 of 3 stored rows",
    );
    expect(store.countRecords({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 })).toBe(3);

    // Un taglio entro la metà resta una sostituzione legittima.
    expect(store.replaceSnapshot("renewable_source_capacity", 2023, [stored[0]!, stored[1]!])).toBe(2);
    expect(store.countRecords({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 })).toBe(2);

    // Il payload vuoto non prova niente e non cancella, come prima.
    expect(store.replaceSnapshot("renewable_source_capacity", 2023, [])).toBe(0);
    expect(store.countRecords({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 })).toBe(2);
  });

  test("l'export CSV neutralizza le formule e lascia intatti gli altri campi", () => {
    store.upsertRecords([
      row({ year: 2024, source: '=HYPERLINK("http://evil")', efficient_power_mw: 1 }),
      row({ year: 2024, source: "+1+cmd", efficient_power_mw: 2 }),
      row({ year: 2024, source: "@SUM(1)", efficient_power_mw: 3 }),
      row({ year: 2024, source: "Eolico", efficient_power_mw: 4 }),
    ]);

    const csv = store.toCsv({} satisfies RecordFilters);

    // Excel eseguirebbe queste celle: l'apice le rende testo (e la quotatura
    // normale resta al suo posto per la virgoletta interna).
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'+1+cmd");
    expect(csv).toContain("'@SUM(1)");
    // I campi normali non guadagnano l'apice.
    expect(csv).toContain("Eolico");
    expect(csv).not.toContain("'Eolico");
  });

  test("l'export CSV non tocca i numeri negativi: l'apice era corruzione dei dati", () => {
    store.upsertRecords([
      row({ year: 2024, source: "Eolico", efficient_power_mw: -1234.567 }),
      row({ year: 2024, source: "Fotovoltaico", efficient_power_mw: 0 }),
      row({ year: 2023, source: "Idrico", efficient_power_mw: -0.5 }),
      row({ year: 2024, source: "=cmd", efficient_power_mw: 1 }),
      row({ year: 2024, source: "+x", efficient_power_mw: 2 }),
      row({ year: 2024, source: "-2+3", efficient_power_mw: 3 }),
      row({ year: 2024, source: "@SUM(1)", efficient_power_mw: 4 }),
    ]);

    const csv = store.toCsv({} satisfies RecordFilters);

    // Un numero finito è già sicuro: l'apice lo trasformava in testo e la
    // colonna smetteva di sommare (i valori negativi spariscono dai totali).
    expect(csv).toContain("-1234.567");
    expect(csv).not.toContain("'-1234.567");
    expect(csv).not.toContain("'-0.5");
    // La riga completa del numero negativo non contiene nemmeno un apice.
    const line = csv.split("\r\n").find((entry) => entry.includes("-1234.567"));
    expect(line).toBe(
      "renewable_source_capacity,2024,Lorda,Lombardia,Milano,Eolico,,,,-1234.567,,2026-01-01T00:00:00+00:00",
    );
    // Solo le stringhe con un carattere di formula restano disinnescate.
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+x");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'@SUM(1)");
  });

  test("la guardia shrink nomina la via d'uscita e la rispetta", () => {
    const stored = [1, 2, 3].map((n) => row({ year: 2023, source: `Fonte${n}`, efficient_power_mw: n }));
    store.upsertRecords(stored);

    // Il rifiuto dice *entrambe* le vie: la variabile e la cancellazione della cache.
    expect(() => store.replaceSnapshot("renewable_source_capacity", 2023, [stored[0]!])).toThrow(
      "TERNA_ALLOW_YEAR_SHRINK=1",
    );
    expect(() => store.replaceSnapshot("renewable_source_capacity", 2023, [stored[0]!])).toThrow(
      "delete terna_cache.sqlite",
    );
    expect(store.countRecords({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 })).toBe(3);

    const before = process.env.TERNA_ALLOW_YEAR_SHRINK;
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => warnings.push(String(message));
    process.env.TERNA_ALLOW_YEAR_SHRINK = "1";
    try {
      // Con la variabile la sostituzione avviene, e l'avviso dice cosa è stato accettato.
      expect(store.replaceSnapshot("renewable_source_capacity", 2023, [stored[0]!])).toBe(1);
    } finally {
      console.warn = warn;
      if (before === undefined) delete process.env.TERNA_ALLOW_YEAR_SHRINK;
      else process.env.TERNA_ALLOW_YEAR_SHRINK = before;
    }

    expect(warnings.join("\n")).toContain("TERNA_ALLOW_YEAR_SHRINK=1");
    expect(store.countRecords({ dataset: "renewable_source_capacity", year_from: 2023, year_to: 2023 })).toBe(1);
  });

  test("busy_timeout waits for the write lock instead of failing straight away", async () => {
    // Cross-process lock contention: SQLite's busy handler waits on a real OS
    // lock, so the one delay below cannot be driven by fake timers (the child
    // must still hold the lock while this process is blocked inside it).
    const script = `
      import { Database } from "bun:sqlite";
      const db = new Database(process.env.ICE_LOCK_DB);
      db.exec("BEGIN IMMEDIATE");
      console.log("locked");
      await Bun.sleep(500);
      db.exec("COMMIT");
      db.close();
    `;
    const holder = Bun.spawn([process.execPath, "-e", script], {
      env: { ...process.env, ICE_LOCK_DB: store.databasePath },
      stdout: "pipe",
      stderr: "ignore",
    });
    try {
      // The child says when the lock is held: no polling, no guessed wait.
      const { value } = await holder.stdout.getReader().read();
      expect(new TextDecoder().decode(value)).toContain("locked");

      // With the SQLite default (busy_timeout = 0) this upsert fails at once
      // with SQLITE_BUSY, which is how a sync step dies when a second instance
      // is open on the same folder.
      store.upsertRecords([row({ year: 2025, source: "Eolico", efficient_power_mw: 7 })]);
      expect(store.countRecords({ year_from: 2025, year_to: 2025 })).toBe(1);
    } finally {
      holder.kill();
      await holder.exited;
    }
  });
});
