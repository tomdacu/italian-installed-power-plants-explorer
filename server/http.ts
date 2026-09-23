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

import { createApi, logInternalError } from "./api.ts";
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

interface ServerOptions {
  store: CapacityStore;
  settings: SettingsStore;
  sync: SyncManager;
  staticDir: string;
  port: number;
  /**
   * `true` quando `port` era occupata e il chiamante ha ripiegato su una porta
   * libera (`serve(0)`): `/health` lo riporta, perché la PWA installata resta
   * legata alla porta del momento dell'installazione.
   */
  portFallback?: boolean;
  hostname?: string;
  /**
   * Dove finiscono gli errori a runtime. Il chiamante (`cli.ts`) passa la
   * funzione che scrive su `backend.log`: senza di essa un 500 restava solo nel
   * terminale e il log che i documenti indicano non lo conteneva mai.
   */
  logger?: (message: string) => void;
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

/** Il loopback è l'unico host che può parlare con questo server. */
const LOOPBACK_HOSTS: Record<string, true> = {
  "127.0.0.1": true,
  localhost: true,
  "::1": true,
  "[::1]": true,
};

/** L'host accettato è il loopback: qualunque altro nome è un rebinding. */
function hostAllowed(host: string | null, port: number): boolean {
  if (!host) return false;
  const withoutPort = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  const portOk = host.endsWith(`:${port}`) || !host.includes(":");
  return portOk && LOOPBACK_HOSTS[withoutPort] === true;
}

/**
 * L'origine extra del dev server. Vite gira su un'altra porta (`:1420`) e il
 * proxy con `changeOrigin` la sostituisce con quella del server, ma senza proxy
 * l'origine resta diversa: l'eccezione è **opt-in** (`ICE_DEV_ORIGIN`), vale per
 * una sola origine e solo se è loopback. Variabile assente = comportamento
 * stretto di sempre.
 */
function isDevOrigin(origin: URL): boolean {
  const configured = process.env.ICE_DEV_ORIGIN?.trim();
  if (!configured) return false;
  try {
    const allowed = new URL(configured);
    return LOOPBACK_HOSTS[allowed.hostname] === true && allowed.origin === origin.origin;
  } catch {
    return false;
  }
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
      // La porta conta: `Origin: http://127.0.0.1` (senza porta) punta alla 80,
      // non a questo server, quindi non è la stessa origine.
      const sameServer = LOOPBACK_HOSTS[parsed.hostname] === true && parsed.port === String(port);
      if (!sameServer && !isDevOrigin(parsed)) {
        return { ok: false, reason: `cross-origin request rejected (origin: ${origin})` };
      }
    } catch {
      return { ok: false, reason: "malformed origin header" };
    }
  }

  return { ok: true };
}

/**
 * Server HTTP locale (nessun websocket: il parametro generico resta undefined).
 * `port` è sempre presente dopo `Bun.serve` — con `port: 0` è quella scelta dal
 * sistema — mentre il tipo di Bun la dichiara opzionale.
 */
export type LocalServer = Server<undefined> & { port: number };

export function startServer(options: ServerOptions): LocalServer {
  const staticRoot = normalize(options.staticDir);
  const indexPath = join(staticRoot, "index.html");
  // La porta effettiva: con `port: 0` la sceglie il sistema, e i controlli su
  // Host/Origin devono confrontarsi con quella vera, non con quella richiesta.
  // `portFallback` lo sa solo chi ha ritentato l'avvio (`app.ts`): qui si
  // riporta e basta. L'oggetto è vivo — `/health` lo legge a ogni richiesta,
  // così dopo `Bun.serve` la porta riportata è quella davvero in ascolto.
  const bound = { port: options.port, portFallback: options.portFallback ?? false };

  const api = createApi({
    store: options.store,
    settings: options.settings,
    sync: options.sync,
    logger: options.logger,
    serverInfo: () => ({ port: bound.port, port_fallback: bound.portFallback }),
  });

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    async fetch(request) {
      // Il controllo dell'host precede qualunque parse dell'URL: una richiesta
      // HTTP/1.0 senza `Host` faceva fallire `new URL(request.url)` con un 500
      // "Invalid URL" (senza header di sicurezza) invece del 403 previsto.
      if (!hostAllowed(request.headers.get("host"), bound.port)) {
        return withSecurityHeaders(
          new Response(JSON.stringify({ detail: "unexpected host header" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      const url = new URL(request.url);

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

      // Le rotte statiche e la shell SPA si **leggono** soltanto: senza questo
      // controllo un `POST`/`OPTIONS` su `/dashboard` riceveva 200 con l'HTML
      // (e il service worker lo memorizzava come se fosse una risposta valida).
      // L'API non passa di qui: i metodi delle sue rotte restano quelli di Hono.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return withSecurityHeaders(
          new Response(JSON.stringify({ detail: "method not allowed" }), {
            status: 405,
            headers: { "content-type": "application/json", allow: "GET, HEAD" },
          }),
        );
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
      return withSecurityHeaders(
        new Response("Interfaccia non trovata: manca la cartella static/ (esegui `bun run build`).", {
          status: 500,
        }),
      );
    },
    error(error) {
      // Un guasto fuori dagli handler finiva solo nel terminale: il log indicato
      // dai documenti non lo vedeva mai. `logger` è la funzione di `cli.ts`.
      logInternalError(error, options.logger);
      return withSecurityHeaders(
        new Response(JSON.stringify({ detail: "internal error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });

  bound.port = server.port ?? options.port;
  return server as LocalServer;
}
