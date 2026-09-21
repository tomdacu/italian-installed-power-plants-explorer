/**
 * Server locale: API JSON + SPA servita dalla stessa origine.
 *
 * Servire la SPA qui è ciò che elimina porta esposta al frontend, CORS ed
 * eccezioni CSP: il browser parla solo con `127.0.0.1:<porta>`.
 */
import type { Server } from "bun";
import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

import { createApi } from "./api.ts";
import type { CapacityStore } from "./db.ts";
import type { SettingsStore } from "./settings.ts";
import type { SyncManager } from "./sync.ts";

/** Prefissi che appartengono all'API: lì un 404 resta un 404 JSON. */
const API_PREFIXES = ["/health", "/settings/", "/sync/", "/metadata/", "/analytics/", "/export/", "/records"];

/** CSP stretta: nessuna risorsa remota, niente eval, solo stessa origine. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

interface ServerOptions {
  store: CapacityStore;
  settings: SettingsStore;
  sync: SyncManager;
  staticDir: string;
  port: number;
  hostname?: string;
}

function withSecurityHeaders(response: Response): Response {
  response.headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

/** Server HTTP locale (nessun websocket: il parametro generico resta undefined). */
export type LocalServer = Server<undefined>;

export function startServer(options: ServerOptions): LocalServer {
  const api = createApi({ store: options.store, settings: options.settings, sync: options.sync });
  const staticRoot = normalize(options.staticDir);
  const indexPath = join(staticRoot, "index.html");

  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);

      if (API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))) {
        return withSecurityHeaders(await api.fetch(request));
      }

      const candidate = normalize(join(staticRoot, url.pathname));
      // `existsSync` è vero anche per una cartella: servire una directory con
      // `Bun.file` faceva rispondere 500 invece del contenuto o di index.html.
      if (
        url.pathname !== "/" &&
        candidate.startsWith(staticRoot) &&
        !url.pathname.endsWith("/") &&
        existsSync(candidate) &&
        statSync(candidate).isFile()
      ) {
        return withSecurityHeaders(new Response(Bun.file(candidate)));
      }
      if (existsSync(indexPath)) {
        return withSecurityHeaders(
          new Response(Bun.file(indexPath), { headers: { "content-type": "text/html; charset=utf-8" } }),
        );
      }
      return new Response("Interfaccia non trovata: manca la cartella static/ (esegui `bun run build`).", {
        status: 500,
      });
    },
  });
}
