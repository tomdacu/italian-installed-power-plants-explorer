import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";

import { cleanupTempDirs, tempDir } from "./temp.ts";

import { createApi } from "../server/api.ts";
import { CapacityStore } from "../server/db.ts";
import type { CapacityRow } from "../server/normalize.ts";
import { SettingsStore } from "../server/settings.ts";
import { SyncManager, type SyncPlan } from "../server/sync.ts";
import type { TernaClient } from "../server/terna.ts";
import type { RecordFilters } from "../shared/types.ts";
import pkg from "../package.json" with { type: "json" };

const STORES: CapacityStore[] = [];

afterAll(() => {
  // Prima le connessioni: su Windows rimuovere un database aperto è EBUSY.
  for (const store of STORES) {
    try {
      store.close();
    } catch {
      /* già chiuso */
    }
  }
  cleanupTempDirs();
});

const FETCHED = "2026-01-01T00:00:00+00:00";

function buildApp(serverInfo: () => { port: number; port_fallback: boolean } = () => ({
  port: 8731,
  port_fallback: false,
})) {
  const root = tempDir("ice-api-");
  const store = new CapacityStore(join(root, "cache.sqlite"));
  STORES.push(store);
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

  return { app: createApi({ store, settings, sync, serverInfo }), store, sync };
}

test("GET /health dice versione, porta effettiva e ripiego sulla porta libera", async () => {
  let info = { port: 8731, port_fallback: false };
  const { app } = buildApp(() => info);

  const response = await app.request("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    version: pkg.version,
    port: 8731,
    port_fallback: false,
  });

  // La porta la sceglie il sistema dentro `Bun.serve`, cioè dopo la creazione
  // dell'API: i valori vanno riletti a ogni richiesta, non fissati una volta.
  info = { port: 54321, port_fallback: true };
  expect(await (await app.request("/health")).json()).toEqual({
    status: "ok",
    version: pkg.version,
    port: 54321,
    port_fallback: true,
  });
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

test("GET /metadata/options espone le liste canoniche e i limiti degli anni", async () => {
  const { app } = buildApp();
  const options = (await (await app.request("/metadata/options")).json()) as {
    known_sources: string[];
    default_capacity_type: string;
    first_year: number;
    installed_capacity_first_year: number;
    current_year: number;
    database: { years: number[] };
  };

  expect(options.known_sources).toContain("Fotovoltaico");
  expect(options.default_capacity_type).toBe("Lorda");
  // La UI prende da qui il range di default: dal primo anno pubblicato a oggi.
  expect(options.first_year).toBe(2000);
  expect(options.installed_capacity_first_year).toBe(2021);
  expect(options.current_year).toBe(new Date().getFullYear());
  expect(options.database.years).toEqual([2024]);
});

test("un job di sync fuori dagli anni pubblicati viene rifiutato", async () => {
  const { app } = buildApp();
  const response = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ years: [1899, 1900] }),
  });

  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ detail: expect.stringContaining("2000") });
});

test("gli anni fuori intervallo vengono limati, non richiesti a Terna", async () => {
  const { app } = buildApp();
  const response = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ years: [1999, 2023, 2023, 2999], datasets: ["renewable_source_capacity"] }),
  });

  expect(response.status).toBe(200);
  const job = (await response.json()) as { job_id: string };
  const status = (await (await app.request(`/sync/jobs/${job.job_id}`)).json()) as { total_steps: number };

  // Resta solo il 2023 (una volta sola): né il 1999 né il 2999 generano richieste.
  expect(status.total_steps).toBe(1);
});

test("gli anni limati finiscono in skipped_steps invece di sparire", async () => {
  const { app } = buildApp();
  const response = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ years: [1999, 2100, 2024], datasets: ["renewable_source_capacity"] }),
  });

  expect(response.status).toBe(200);
  const { job_id } = (await response.json()) as { job_id: string };
  const status = (await (await app.request(`/sync/jobs/${job_id}`)).json()) as {
    total_steps: number;
    skipped_steps: number;
  };

  // Il 1999 (prima del primo anno pubblicato) e il 2100 (nel futuro) sono passi
  // mai eseguiti come quelli che un dataset non pubblica: senza il conteggio il
  // job sembrava aver coperto un intervallo che non ha mai chiesto.
  expect(status.total_steps).toBe(1);
  expect(status.skipped_steps).toBeGreaterThanOrEqual(2);
});

test("anni duplicati non diventano passi saltati: la deduplica è silenziosa", async () => {
  const { app } = buildApp();
  const post = (years: number[]) =>
    app.request("/sync/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ years, datasets: ["renewable_source_capacity"] }),
    });
  const counts = async (years: number[]) => {
    const response = await post(years);
    expect(response.status).toBe(200);
    const { job_id } = (await response.json()) as { job_id: string };
    return (await (await app.request(`/sync/jobs/${job_id}`)).json()) as {
      total_steps: number;
      skipped_steps: number;
    };
  };

  // Lo stesso anno richiesto due volte: un passo solo, zero saltati — prima
  // `years.length - kept.length` contava il duplicato come «non pubblicato» e
  // la UI raccontava un anno inesistente agli utenti.
  const dup = await counts([2024, 2024]);
  expect(dup.total_steps).toBe(1);
  expect(dup.skipped_steps).toBe(0);

  // Un fuori-range ripetuto conta una volta sola: l'unico vero salto è il 1999.
  const mixed = await counts([1999, 1999, 2024]);
  expect(mixed.total_steps).toBe(1);
  expect(mixed.skipped_steps).toBe(1);
});

test("DELETE /sync/jobs/:jobId cancella il job, 404 su un id ignoto", async () => {
  const root = tempDir("ice-api-");
  const store = new CapacityStore(join(root, "cache.sqlite"));
  STORES.push(store);
  // Un passo che non torna mai: il job resta in corsa finché non lo si cancella.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = {
    renewableSourceCapacity: async () => {
      await gate;
      return {};
    },
  } as unknown as TernaClient;
  const sync = new SyncManager(store, async () => client);
  const app = createApi({
    store,
    settings: new SettingsStore(root),
    sync,
    serverInfo: () => ({ port: 8731, port_fallback: false }),
  });

  const created = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ years: [2024], datasets: ["renewable_source_capacity"] }),
  });
  const { job_id } = (await created.json()) as { job_id: string };

  const response = await app.request(`/sync/jobs/${job_id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ job_id, status: "cancelled", message: "Sync cancelled" });
  // Lo stato resta cancellato anche al polling successivo.
  expect(await (await app.request(`/sync/jobs/${job_id}`)).json()).toMatchObject({ status: "cancelled" });
  // Il passo in volo non ha ancora scritto niente in cache.
  expect(store.countRecords({})).toBe(0);

  const missing = await app.request("/sync/jobs/inesistente", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ detail: "Sync job not found" });

  release();
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
  expect((await app.request("/sync/jobs/latest")).status).toBe(404);
});

test("tutte le route filtrate rispondono 400 a un dataset sconosciuto", async () => {
  const { app } = buildApp();
  for (const path of [
    "/records",
    "/metadata/data-quality",
    "/analytics/summary",
    "/analytics/timeseries",
    "/export/csv",
  ]) {
    const response = await app.request(`${path}?dataset=unknown`);
    expect(response.status).toBe(400);
  }
});

test("il job più recente resta recuperabile dopo aver lasciato la pagina", async () => {
  const { app } = buildApp();
  const created = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ years: [2024], datasets: ["renewable_source_capacity"] }),
  });
  const { job_id } = await created.json() as { job_id: string };
  const latest = await app.request("/sync/jobs/latest");
  expect(latest.status).toBe(200);
  expect(await latest.json()).toMatchObject({ job_id });
});

test("GET /records ordina per la colonna della tabella e rifiuta i campi ignoti", async () => {
  const { app } = buildApp();

  // La colonna "Type" della tabella manda `sort=type`: senza `type` nella
  // whitelist la tabella veniva sostituita dall'errore (R2, regressione).
  const byType = await app.request("/records?limit=3&sort=type&order=desc");
  expect(byType.status).toBe(200);

  const bogus = await app.request("/records?sort=bogus");
  expect(bogus.status).toBe(400);
  expect(await bogus.json()).toMatchObject({ detail: expect.stringContaining("sort must be one of") });
});

test("GET /records rifiuta limit e offset fuori intervallo invece di limarli in silenzio", async () => {
  const { app } = buildApp();

  // `limit=0` tornava una riga e `offset=-1` diventava 0: entrambi indistinguibili
  // da un filtro rispettato.
  for (const query of ["limit=0", "limit=-1", "offset=-1", "limit=abc", "offset=abc", "limit=1.9", "offset=0.9"]) {
    const response = await app.request(`/records?${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ detail: expect.stringContaining("limit") });
  }

  // Il caso normale non cambia.
  expect((await app.request("/records?limit=1&offset=0")).status).toBe(200);
});

test("un job senza passi eseguibili non arriva mai a sync.start", async () => {
  const { app, sync } = buildApp();
  // L'ordine è il punto: pre-fix il job entrava nella mappa e la risposta era
  // comunque 422, lasciando un job che nessuno avrebbe mai eseguito.
  let started = 0;
  const start = sync.start.bind(sync);
  sync.start = (plan: SyncPlan) => {
    started += 1;
    return start(plan);
  };

  const rejected = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `/installed-capacity` rifiuta tutto ciò che precede il 2021: nessun passo.
    body: JSON.stringify({ years: [2000], datasets: ["installed_capacity"] }),
  });

  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toMatchObject({ detail: expect.stringContaining("no step") });
  expect(started).toBe(0);

  // Controllo: una richiesta con passi veri arriva a `start` (il contatore non è muto).
  const accepted = await app.request("/sync/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ years: [2023], datasets: ["renewable_source_capacity"] }),
  });
  expect(accepted.status).toBe(200);
  expect(started).toBe(1);
});

test("filtri tipizzati accettano dataset noti e ignorano quelli ignoti", async () => {
  const { store } = buildApp();
  const known = store.records({ dataset: "renewable_source_capacity" } satisfies RecordFilters);
  const unknown = store.records({ dataset: "inesistente" as never } satisfies RecordFilters);

  expect(known).toHaveLength(1);
  expect(unknown).toHaveLength(0);
});

test("una rotta API inesistente risponde 404 JSON, non testo semplice", async () => {
  const { app } = buildApp();

  // Il 404 predefinito di Hono era `text/plain`: il server promette JSON ovunque.
  const missing = await app.request("/recordsssss");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("content-type")).toContain("application/json");
  expect(await missing.json()).toEqual({ detail: "Not found" });

  // I 404 già JSON (job inesistente) restano quelli di prima.
  const job = await app.request("/sync/jobs/inesistente");
  expect(job.status).toBe(404);
  expect(await job.json()).toEqual({ detail: "Sync job not found" });
});

test("una q oltre i 200 caratteri è un 400 esplicito, non una connessione caduta", async () => {
  const { app } = buildApp();

  // Pre-fix la richiesta falliva a livello di trasporto (505/reset) e il client
  // mostrava «service non rispondente»: ora il rifiuto è un 400 con il dettaglio.
  for (const path of ["/records", "/analytics/summary", "/export/csv"]) {
    const tooLong = await app.request(`${path}?q=${"a".repeat(201)}`);
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ detail: expect.stringContaining("200") });
  }

  // Al limite il comportamento non cambia: una `q` di 200 caratteri è accettata.
  const atLimit = await app.request(`/records?q=${"a".repeat(200)}`);
  expect(atLimit.status).toBe(200);
  expect(await atLimit.json()).toEqual([]);

  // E il filtro noto continua a dare gli stessi risultati (substring, senza
  // distinzione di maiuscole).
  for (const query of ["Chieti", "chieti"]) {
    const found = await app.request(`/records?q=${query}`);
    expect(found.status).toBe(200);
    const rows = (await found.json()) as { province: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].province).toBe("Chieti");
  }
});
