/**
 * Composizione dell'applicazione: cache, impostazioni, sync e server HTTP.
 * Qui vive il "cablaggio", così CLI e test partono dallo stesso oggetto.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CapacityStore } from "./db.ts";
import { SettingsStore } from "./settings.ts";
import { startServer, type LocalServer } from "./http.ts";
import { SyncManager } from "./sync.ts";
import { MIN_REQUEST_INTERVAL, TernaApiError, TernaClient } from "./terna.ts";

/**
 * Dove sta la SPA compilata.
 *
 * In sviluppo è `dist/` nel repo; nel pacchetto npm è `static/` accanto al
 * server; nell'eseguibile compilato `import.meta.dir` è un percorso virtuale,
 * quindi l'unico riferimento affidabile è la cartella dell'eseguibile.
 */
export function resolveStaticDir(): string {
  const candidates = [
    process.env.ICE_STATIC_DIR,
    join(dirname(process.execPath), "static"),
    join(dirname(import.meta.dir), "static"),
    resolve(import.meta.dir, "..", "dist"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const found = candidates.find((candidate) => existsSync(join(candidate, "index.html")));
  if (!found) {
    console.error(
      `SPA non trovata. Cercata in:\n  ${candidates.join("\n  ")}\n` +
        "In sviluppo esegui `bun run build`; l'eseguibile compilato ha bisogno della cartella static/ accanto a sé.",
    );
  }
  return found ?? candidates[0];
}

export interface StartOptions {
  port?: number;
  dataDir?: string;
  staticDir?: string;
}

export function startApp(options: StartOptions = {}) {
  const settings = new SettingsStore(options.dataDir);
  const appSettings = settings.load();
  const store = new CapacityStore(appSettings.databasePath);

  const sync = new SyncManager(store, async () => {
    const current = settings.load();
    const secret = await settings.getClientSecret(current.clientId ?? undefined);
    if (!current.clientId || !secret) throw new TernaApiError("Terna credentials are not configured");
    return new TernaClient(current.clientId, secret, MIN_REQUEST_INTERVAL);
  });

  const serve = (port: number) =>
    startServer({ store, settings, sync, staticDir: options.staticDir ?? resolveStaticDir(), port });

  // La porta preferita resta stabile (serve alla PWA installata); se è occupata
  // si ripiega su una porta libera scelta dal sistema operativo.
  let server: LocalServer;
  let fallback = false;
  try {
    server = serve(options.port ?? 0);
  } catch (error) {
    if (!options.port) throw error;
    fallback = true;
    server = serve(0);
  }

  return {
    server,
    store,
    settings,
    sync,
    port: server.port,
    portFallback: fallback,
    url: `http://127.0.0.1:${server.port}`,
    stop() {
      server.stop(true);
      store.close();
    },
  };
}
