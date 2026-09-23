/**
 * Gli strumenti di costruzione condivisi dai test: UNA API per l'app di prova,
 * UNA per il server vero su una porta libera, UNA per le fake del sync.
 *
 * Qui si centralizza **solo la costruzione**. I teardown restano locali a
 * ciascun file: `afterAll` importato non è un'aspettativa globale per Bun,
 * quindi ogni file continua a chiudere i propri store e a chiamare
 * `cleanupTempDirs()` per conto suo. Per lo stesso motivo i registri (`stores`,
 * `servers`) sono passati dal chiamante: è il file a possederli.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Hono } from "hono";

import { createApi } from "../server/api.ts";
import { CapacityStore } from "../server/db.ts";
import { startServer, type LocalServer } from "../server/http.ts";
import type { CapacityRow } from "../server/normalize.ts";
import { SettingsStore } from "../server/settings.ts";
import { SyncManager } from "../server/sync.ts";
import type { TernaClient } from "../server/terna.ts";

import { tempDir } from "./temp.ts";

/** L'istante scritto in `fetched_at`: fisso, così le attese sui CSV non ballano. */
export const FETCHED = "2026-01-01T00:00:00+00:00";

/** La riga che l'app di prova si trova già in cache: Abruzzo/Chieti 2024. */
export const SEEDED_ROW: CapacityRow = {
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
};

/** Chi risponde al posto di Terna. */
export type ClientFactory = () => Promise<TernaClient>;

/** Nessuna credenziale nei test: il sync non deve poter uscire in rete. */
export const noCredentials: ClientFactory = () => {
  throw new Error("nessuna credenziale nei test");
};

/** Uno `SyncManager` con un client finto: la stessa coda di produzione, nessuna rete. */
export function testSync(store: CapacityStore, client: TernaClient): SyncManager {
  return new SyncManager(store, async () => client);
}

/** Il client finto minimo: risponde "nessun dato" al dataset che il piano invoca. */
export function emptyClient(): TernaClient {
  return { renewableSourceCapacity: async () => ({}) } as unknown as TernaClient;
}

/** Lo store di una radice già creata: `cache.sqlite`, come in produzione. */
function storeAt(root: string, stores: CapacityStore[]): CapacityStore {
  const store = new CapacityStore(join(root, "cache.sqlite"));
  stores.push(store);
  return store;
}

/** Uno store su disco in una radice temporanea nuova: nessun settings né sync intorno. */
export function testStore(stores: CapacityStore[], prefix: string): CapacityStore {
  return storeAt(tempDir(prefix), stores);
}

/** Un `SettingsStore` su una radice temporanea nuova: `store.dataDir` è la radice. */
export function testSettings(prefix: string): SettingsStore {
  return new SettingsStore(tempDir(prefix));
}

interface TestEnv {
  root: string;
  store: CapacityStore;
  settings: SettingsStore;
  sync: SyncManager;
}

/** Radice temporanea + store su disco + settings + sync: la base di app e server. */
function testEnv(prefix: string, stores: CapacityStore[], client: ClientFactory): TestEnv {
  const root = tempDir(prefix);
  const store = storeAt(root, stores);
  return { root, store, settings: new SettingsStore(root), sync: new SyncManager(store, client) };
}

export interface TestAppOptions {
  /** Prefisso della radice temporanea: `temp.ts` tiene l'elenco per lo sweep. */
  prefix: string;
  /** Il registro locale del file: è il file a chiuderlo nel suo `afterAll`. */
  stores: CapacityStore[];
  /** Chi risponde al posto di Terna. Default: nessuna credenziale. */
  client?: ClientFactory;
  /** Mette in cache la riga di prova. Default: sì. */
  seed?: boolean;
  serverInfo?: () => { port: number; port_fallback: boolean };
}

/** L'app API di prova e le sue parti, così come le restituisce `testApp`. */
export interface TestApp {
  app: Hono;
  store: CapacityStore;
  sync: SyncManager;
  root: string;
}

/** L'app API in memoria, costruita come in produzione (`createApi`). */
export function testApp(options: TestAppOptions): TestApp {
  const { root, store, settings, sync } = testEnv(options.prefix, options.stores, options.client ?? noCredentials);
  if (options.seed !== false) store.upsertRecords([SEEDED_ROW]);
  return {
    app: createApi({
      store,
      settings,
      sync,
      serverInfo: options.serverInfo ?? (() => ({ port: 8731, port_fallback: false })),
    }),
    store,
    sync,
    root,
  };
}

export interface TestServerOptions {
  /** Prefisso della radice temporanea: `temp.ts` tiene l'elenco per lo sweep. */
  prefix: string;
  stores: CapacityStore[];
  /** Il registro locale del file: è il file a fermare i server nel suo `afterAll`. */
  servers: LocalServer[];
  client?: ClientFactory;
  logger?: (message: string) => void;
  /** Crea una `index.html` vera: senza, la shell SPA manca ed è il caso 500. */
  shell?: boolean;
}

/** Il server di prova e le sue parti, così come le restituisce `testServer`. */
export interface TestServer {
  origin: string;
  port: number;
  store: CapacityStore;
  root: string;
}

/** Un server vero su una porta libera: le guardie si provano sulla richiesta, non a unità. */
export function testServer(options: TestServerOptions): TestServer {
  const { root, store, settings, sync } = testEnv(options.prefix, options.stores, options.client ?? noCredentials);
  // Senza `shell` la cartella `static/` non esiste: è il caso "interfaccia non
  // costruita" (500). Con `shell: true` c'è una index.html vera da servire.
  const staticDir = join(root, "static");
  if (options.shell) {
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>shell</title>");
  }
  const server = startServer({ store, settings, sync, staticDir, port: 0, logger: options.logger });
  options.servers.push(server);
  const port = server.port;
  return { origin: `http://127.0.0.1:${port}`, port, store, root };
}
