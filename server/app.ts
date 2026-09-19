/**
 * Composizione dell'applicazione: cache, impostazioni, sync e server HTTP.
 * Qui vive il "cablaggio", così CLI e test partono dallo stesso oggetto.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CapacityStore } from "./db.ts";
import { SettingsStore } from "./settings.ts";
import { startServer } from "./http.ts";
import { SyncManager } from "./sync.ts";
import { MIN_REQUEST_INTERVAL, TernaApiError, TernaClient } from "./terna.ts";

/** In sviluppo la SPA sta in `dist/`; nel pacchetto accanto al server (`static/`). */
export function resolveStaticDir(): string {
  const candidates = [
    process.env.ICE_STATIC_DIR,
    join(dirname(import.meta.dir), "static"),
    resolve(import.meta.dir, "..", "dist"),
    resolve(import.meta.dir, "..", "..", "dist"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(join(candidate, "index.html"))) ?? candidates[0];
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

  const server = startServer({
    store,
    settings,
    sync,
    staticDir: options.staticDir ?? resolveStaticDir(),
    port: options.port ?? 0,
  });

  return {
    server,
    store,
    settings,
    sync,
    port: server.port,
    url: `http://127.0.0.1:${server.port}`,
    stop() {
      server.stop(true);
      store.close();
    },
  };
}
