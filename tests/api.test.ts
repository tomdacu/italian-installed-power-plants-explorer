import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApi } from "../server/api.ts";
import { CapacityStore } from "../server/db.ts";
import type { CapacityRow } from "../server/normalize.ts";
import { SettingsStore } from "../server/settings.ts";
import { SyncManager } from "../server/sync.ts";
import type { RecordFilters } from "../shared/types.ts";

const FETCHED = "2026-01-01T00:00:00+00:00";

function buildApp() {
  const root = mkdtempSync(join(tmpdir(), "ice-api-"));
  const store = new CapacityStore(join(root, "cache.sqlite"));
  const settings = new SettingsStore(root);
  const sync = new SyncManager(store, () => {
    throw new Error("nessuna credenziale nei test");
  });

  const rows: CapacityRow[] = [
    {
      dataset: "renewable_source_capacity",
      year: 2024,
      capacity_type: "Lorda",
      region: "Abruzzo",
      province: "Chieti",
      source: "Fotovoltaico",
      category: null,
      subcategory: null,
      type: null,
      efficient_power_mw: 351.403,
      installed_capacity_gw: null,
      fetched_at: FETCHED,
    },
  ];
  store.upsertRecords(rows);

  return { app: createApi({ store, settings, sync }), store };
}

test("GET /health risponde come la versione Python", async () => {
  const { app } = buildApp();
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("GET /records applica i filtri della query", async () => {
  const { app } = buildApp();
  const response = await app.request("/records?dataset=renewable_source_capacity&region=Abruzzo");
  const rows = (await response.json()) as { source: string; efficient_power_mw: number }[];

  expect(rows).toHaveLength(1);
  expect(rows[0].efficient_power_mw).toBe(351.403);
});

test("GET /analytics/summary restituisce lo stock dell'indice singolo", async () => {
  const { app } = buildApp();
  const summary = (await (await app.request("/analytics/summary?dataset=renewable_source_capacity")).json()) as {
    latest_year: number;
    latest_total_efficient_power_mw: number;
    capacity_type_applied: string;
  };

  expect(summary.latest_year).toBe(2024);
  expect(summary.latest_total_efficient_power_mw).toBe(351.403);
  expect(summary.capacity_type_applied).toBe("Lorda");
});

test("GET /analytics/timeseries valida group_by", async () => {
  const { app } = buildApp();

  const bad = await app.request("/analytics/timeseries?group_by=year%3B%20DROP%20TABLE%20x");
  expect(bad.status).toBe(400);

  const good = await app.request("/analytics/timeseries?group_by=year,source&capacity_type=Lorda");
  const rows = (await good.json()) as { year: number; source: string }[];
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe("Fotovoltaico");
});

test("GET /metadata/options espone le liste canoniche", async () => {
  const { app } = buildApp();
  const options = (await (await app.request("/metadata/options")).json()) as {
    known_sources: string[];
    default_capacity_type: string;
    installed_capacity_year_window: number;
    database: { years: number[] };
  };

  expect(options.known_sources).toContain("Fotovoltaico");
  expect(options.default_capacity_type).toBe("Lorda");
  expect(options.installed_capacity_year_window).toBe(7);
  expect(options.database.years).toEqual([2024]);
});

test("GET /export/csv risponde con nome file e contenuto", async () => {
  const { app } = buildApp();
  const response = await app.request("/export/csv?dataset=renewable_source_capacity");

  expect(response.headers.get("content-disposition")).toContain("italian-renewable-capacity-records.csv");
  expect(await response.text()).toContain("Abruzzo");
});

test("le credenziali non configurate danno configured:false", async () => {
  const { app } = buildApp();
  const status = (await (await app.request("/settings/credentials/status")).json()) as { configured: boolean };

  expect(status.configured).toBe(false);
});

test("un job di sync inesistente risponde 404", async () => {
  const { app } = buildApp();
  expect((await app.request("/sync/jobs/inesistente")).status).toBe(404);
});

test("filtri tipizzati accettano dataset noti e ignorano quelli ignoti", async () => {
  const { store } = buildApp();
  const known = store.records({ dataset: "renewable_source_capacity" } satisfies RecordFilters);
  const unknown = store.records({ dataset: "inesistente" as never } satisfies RecordFilters);

  expect(known).toHaveLength(1);
  expect(unknown).toHaveLength(0);
});
