/**
 * Composizione dell'applicazione: cache, impostazioni, sync e server HTTP.
 * Qui vive il "cablaggio", così CLI e test partono dallo stesso oggetto.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createTernaClient } from "./client.ts";
import { CapacityStore } from "./db.ts";
import { SettingsStore } from "./settings.ts";
import { startServer, type LocalServer } from "./http.ts";
import { SyncManager } from "./sync.ts";

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

  const sync = new SyncManager(store, () => createTernaClient(settings));

  const serve = (port: number) =>
    startServer({ store, settings, sync, staticDir: options.staticDir ?? resolveStaticDir(), port });

  // La porta preferita resta stabile (serve alla PWA installata); se è occupata
  // si ripiega su una porta libera scelta dal sistema operativo.
  // Una porta non numerica (ICE_PORT sbagliata, chiamata da un altro modulo)
  // deve cadere sulla scelta automatica, non far fallire l'avvio.
  const requested = Number.isInteger(options.port) && options.port! > 0 ? options.port! : 0;
  let server: LocalServer;
  let fallback = false;
  try {
    server = serve(requested);
  } catch (error) {
    if (!requested) throw error;
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
