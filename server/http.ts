/**
 * Server locale: API JSON + SPA servita dalla stessa origine.
 *
 * Servire la SPA qui è ciò che elimina porta esposta al frontend, CORS ed
 * eccezioni CSP: il browser parla solo con `127.0.0.1:<porta>`.
 *
 * Non c'è autenticazione — è un'app locale — ma le altre pagine web **non**
 * devono poter parlare con questo server: senza i controlli qui sotto una
 * richiesta "semplice" (niente preflight, quindi senza CORS) bastava a
 * riscrivere le credenziali, e un dominio che punta a 127.0.0.1 (DNS rebinding)
 * poteva leggere i dati.
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

/** Metodi che cambiano qualcosa: lì la provenienza va verificata. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** CSP stretta: nessuna risorsa remota, niente eval, solo stessa origine. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface ServerOptions {
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
  // Nessun altro documento può incorniciare l'app (clickjacking su un'app locale
  // significherebbe far premere "Download" o "Delete credentials" a sorpresa).
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), usb=(), serial=()");
  return response;
}

/** L'host accettato è il loopback: qualunque altro nome è un rebinding. */
function hostAllowed(host: string | null, port: number): boolean {
  if (!host) return false;
  const withoutPort = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  const portOk = host.endsWith(`:${port}`) || !host.includes(":");
  return portOk && (withoutPort === "127.0.0.1" || withoutPort === "localhost" || withoutPort === "::1");
}

/**
 * Una richiesta che cambia stato deve venire dalla stessa origine. Con
 * `Content-Type: application/json` il browser è costretto al preflight (che non
 * rispondiamo), quindi le pagine esterne non possono più scrivere.
 */
function mutationAllowed(request: Request, port: number): { ok: true } | { ok: false; reason: string } {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, reason: "mutating requests must be sent as application/json" };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, reason: `cross-site request rejected (sec-fetch-site: ${fetchSite})` };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      const allowedHosts = ["127.0.0.1", "localhost", "::1", "[::1]"];
      const portOk = parsed.port === String(port) || parsed.port === "";
      if (!allowedHosts.includes(parsed.hostname) || !portOk) {
        return { ok: false, reason: `cross-origin request rejected (origin: ${origin})` };
      }
    } catch {
      return { ok: false, reason: "malformed origin header" };
    }
  }

  return { ok: true };
}

/** Server HTTP locale (nessun websocket: il parametro generico resta undefined). */
export type LocalServer = Server<undefined>;

export function startServer(options: ServerOptions): LocalServer {
  const api = createApi({ store: options.store, settings: options.settings, sync: options.sync });
  const staticRoot = normalize(options.staticDir);
  const indexPath = join(staticRoot, "index.html");
  // La porta effettiva: con `port: 0` la sceglie il sistema, e i controlli su
  // Host/Origin devono confrontarsi con quella vera, non con quella richiesta.
  const bound = { port: options.port };

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);

      if (!hostAllowed(request.headers.get("host"), bound.port)) {
        return withSecurityHeaders(
          new Response(JSON.stringify({ detail: "unexpected host header" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (MUTATING_METHODS.has(request.method)) {
        const allowed = mutationAllowed(request, bound.port);
        if (!allowed.ok) {
          return withSecurityHeaders(
            new Response(JSON.stringify({ detail: allowed.reason }), {
              status: 403,
              headers: { "content-type": "application/json" },
            }),
          );
        }
      }

      if (API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))) {
        const response = withSecurityHeaders(await api.fetch(request));
        // Le risposte dell'API sono dati locali che cambiano: mai in cache.
        response.headers.set("cache-control", "no-store");
        return response;
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
        const response = withSecurityHeaders(new Response(Bun.file(candidate)));
        // I nomi sotto /assets/ contengono l'hash del contenuto: possono essere
        // tenuti per sempre. La shell e il service worker no.
        response.headers.set(
          "cache-control",
          url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
        return response;
      }
      // Un file richiesto e non trovato è un 404: la shell SPA va servita solo
      // per le rotte dell'app (niente estensione), altrimenti una risorsa
      // mancante riceve 200 + HTML e il service worker la memorizza così.
      if (url.pathname.startsWith("/assets/") || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
        return withSecurityHeaders(
          new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }),
        );
      }
      if (existsSync(indexPath)) {
        const response = withSecurityHeaders(
          new Response(Bun.file(indexPath), { headers: { "content-type": "text/html; charset=utf-8" } }),
        );
        response.headers.set("cache-control", "no-cache");
        return response;
      }
      return new Response("Interfaccia non trovata: manca la cartella static/ (esegui `bun run build`).", {
        status: 500,
      });
    },
    error(error) {
      console.error(error);
      return new Response(JSON.stringify({ detail: "internal error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    },
  });

  bound.port = server.port ?? options.port;
  return server;
}
