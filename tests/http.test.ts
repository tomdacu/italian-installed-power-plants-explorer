/**
 * Le guardie di `server/http.ts` provate sul filo, contro un server vero su una
 * porta libera: Host, Content-Type, Origin e `Sec-Fetch-Site`.
 *
 * R1 — la SPA manda `Content-Type: application/json` anche sulle chiamate
 * mutanti **senza corpo** (`Remove`, `Test connection`): se il client smette di
 * farlo tornano 403 e il caso «client vero» qui sotto lo dice subito.
 * R3 — l'origine del dev server Vite è accettata solo se dichiarata a mano in
 * `ICE_DEV_ORIGIN`, e solo se è loopback.
 */
import { afterAll, expect, test } from "bun:test";
import { connect } from "node:net";
import { join } from "node:path";

import { cleanupTempDirs, tempDir } from "./temp.ts";

import { ApiError, api } from "../src/api/client.ts";
import { CapacityStore } from "../server/db.ts";
import { CONTENT_SECURITY_POLICY, startServer, type LocalServer } from "../server/http.ts";
import { SettingsStore } from "../server/settings.ts";
import { SyncManager } from "../server/sync.ts";

// `getClientSecret` preferisce questa variabile d'ambiente: i test non devono
// poter usare credenziali vere (né fare richieste a Terna).
delete process.env.TERNA_CLIENT_SECRET;

const STORES: CapacityStore[] = [];
const SERVERS: LocalServer[] = [];

afterAll(async () => {
  for (const server of SERVERS) await server.stop(true);
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

/** Un server vero su una porta libera: la guardia si prova sulla richiesta, non a unità. */
function startTestServer(options: { logger?: (message: string) => void } = {}): {
  origin: string;
  port: number;
  store: CapacityStore;
} {
  const root = tempDir("ice-http-");
  const store = new CapacityStore(join(root, "cache.sqlite"));
  STORES.push(store);
  const sync = new SyncManager(store, () => {
    throw new Error("nessuna credenziale nei test");
  });
  const server = startServer({
    store,
    settings: new SettingsStore(root),
    sync,
    staticDir: join(root, "static"),
    port: 0,
    logger: options.logger,
  });
  SERVERS.push(server);
  const port = server.port;
  return { origin: `http://127.0.0.1:${port}`, port, store };
}

/** Richiesta scritta a mano: `fetch` non lascia né omettere né falsificare `Host`. */
function rawRequest(port: number, lines: string[]): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1");
  let received = "";
  socket.setEncoding("utf8");
  socket.on("connect", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
  socket.on("data", (chunk: string) => {
    received += chunk;
    // Riga di stato e intestazioni bastano: il corpo non serve a nessun caso.
    if (!received.includes("\r\n\r\n")) return;
    socket.destroy();
    resolve(received);
  });
  // La connessione si chiude da sé (`Connection: close`) o perché l'abbiamo chiusa noi.
  socket.on("close", () => resolve(received));
  socket.on("error", reject);
  return promise;
}

/** Una richiesta mutante con l'host giusto: le intestazioni in prova le aggiunge il chiamante. */
function mutation(port: number, method: string, path: string, headers: string[] = []): Promise<string> {
  return rawRequest(port, [`${method} ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, "Connection: close", ...headers]);
}

/** Il codice di stato di una risposta grezza. */
const statusOf = (response: string): number => Number(response.split(" ")[1]);

test("R1: le chiamate senza corpo della SPA attraversano la guardia Content-Type", async () => {
  const { port } = startTestServer();
  const spaHeaders = [
    `Origin: http://127.0.0.1:${port}`,
    "Sec-Fetch-Site: same-origin",
    "Content-Type: application/json",
  ];

  // `Remove`: nessun corpo, `Content-Type` dichiarato dal client (v1.1.0).
  expect(statusOf(await mutation(port, "DELETE", "/settings/credentials", spaHeaders))).toBe(200);
  // `Test connection`: oltre la guardia si arriva alle credenziali, che mancano.
  const tested = await mutation(port, "POST", "/settings/credentials/test", spaHeaders);
  expect(statusOf(tested)).toBe(502);
  expect(tested).not.toContain("cross-origin");

  // Le stesse due richieste senza intestazioni restano respinte: la guardia è intatta.
  expect(statusOf(await mutation(port, "DELETE", "/settings/credentials"))).toBe(403);
  expect(statusOf(await mutation(port, "POST", "/settings/credentials/test"))).toBe(403);
});

test("R1: il client della SPA manda da sé il Content-Type sulle chiamate senza corpo", async () => {
  const { origin } = startTestServer();
  // Il comando esterno punta l'API con `window.__TERNA_API_BASE__`; nel test è
  // l'unico modo per far parlare il client vero con il server di prova.
  const host = globalThis as unknown as { window?: { __TERNA_API_BASE__?: string } };
  const previous = host.window;
  host.window = { __TERNA_API_BASE__: origin };
  try {
    expect((await api.deleteCredentials()).configured).toBe(false);

    // 502 (credenziali assenti), non 403 (provenienza): il client si è annunciato JSON.
    let status = 0;
    try {
      await api.testCredentials();
    } catch (error) {
      status = error instanceof ApiError ? error.status : -1;
    }
    expect(status).toBe(502);
  } finally {
    host.window = previous;
  }
});

test("R3: l'origine del dev server è accettata solo se dichiarata e loopback", async () => {
  const { port } = startTestServer();
  const devOrigin = ["Origin: http://localhost:1420", "Sec-Fetch-Site: same-origin", "Content-Type: application/json"];

  // Senza variabile vale il comportamento stretto: Vite non scrive.
  expect(statusOf(await mutation(port, "POST", "/settings/credentials/test", devOrigin))).toBe(403);

  process.env.ICE_DEV_ORIGIN = "http://localhost:1420";
  try {
    expect(statusOf(await mutation(port, "POST", "/settings/credentials/test", devOrigin))).toBe(502);
    // Vale per quella sola origine: un'altra porta resta respinta.
    const other = ["Origin: http://localhost:5173", "Sec-Fetch-Site: same-origin", "Content-Type: application/json"];
    expect(statusOf(await mutation(port, "POST", "/settings/credentials/test", other))).toBe(403);
  } finally {
    delete process.env.ICE_DEV_ORIGIN;
  }

  // Un'origine non loopback non è ammessa nemmeno se dichiarata.
  process.env.ICE_DEV_ORIGIN = "https://example.com";
  try {
    const external = ["Origin: https://example.com", "Content-Type: application/json"];
    expect(statusOf(await mutation(port, "POST", "/settings/credentials/test", external))).toBe(403);
  } finally {
    delete process.env.ICE_DEV_ORIGIN;
  }
});

test("l'origine esterna, il cross-site e il loopback senza porta non scrivono", async () => {
  const { port } = startTestServer();

  expect(
    statusOf(await mutation(port, "POST", "/settings/credentials/test", ["Content-Type: application/json", "Origin: https://example.com"])),
  ).toBe(403);
  expect(
    statusOf(await mutation(port, "POST", "/settings/credentials/test", ["Content-Type: application/json", "Sec-Fetch-Site: cross-site"])),
  ).toBe(403);
  // `http://127.0.0.1` senza porta è la 80: non è questo server.
  expect(
    statusOf(await mutation(port, "POST", "/settings/credentials/test", ["Content-Type: application/json", "Origin: http://127.0.0.1"])),
  ).toBe(403);
  // Anche una richiesta "semplice" (niente preflight) resta respinta.
  expect(
    statusOf(await mutation(port, "POST", "/settings/credentials/test", ["Content-Type: text/plain", `Origin: http://127.0.0.1:${port}`])),
  ).toBe(403);

  // Controllo: la stessa richiesta dalla stessa origine arriva all'API.
  expect(
    statusOf(
      await mutation(port, "POST", "/settings/credentials/test", [
        "Content-Type: application/json",
        `Origin: http://127.0.0.1:${port}`,
        "Sec-Fetch-Site: same-origin",
      ]),
    ),
  ).toBe(502);
});

test("un Host che non è il loopback è respinto", async () => {
  const { port } = startTestServer();

  const rebinding = await rawRequest(port, ["GET /health HTTP/1.1", "Host: evil.example", "Connection: close"]);
  expect(statusOf(rebinding)).toBe(403);
  expect(rebinding).toContain("unexpected host header");

  // Il controllo dell'host non blocca la richiesta legittima.
  const legit = await rawRequest(port, ["GET /health HTTP/1.1", `Host: 127.0.0.1:${port}`, "Connection: close"]);
  expect(statusOf(legit)).toBe(200);
});

test("una richiesta HTTP/1.0 senza Host è un 403 con gli header di sicurezza", async () => {
  const { port } = startTestServer();

  // Senza `Host` il parse dell'URL falliva: 500 «Invalid URL» prima della guardia.
  const response = await rawRequest(port, ["GET /health HTTP/1.0"]);
  expect(statusOf(response)).toBe(403);
  expect(response).toContain(CONTENT_SECURITY_POLICY);
  expect(response.toLowerCase()).toContain("x-content-type-options: nosniff");
});

test("anche il 500 porta gli header di sicurezza", async () => {
  const { port } = startTestServer();

  // Nessuna interfaccia costruita: la shell SPA manca e il server lo dice con un 500.
  const response = await rawRequest(port, ["GET /dashboard HTTP/1.1", `Host: 127.0.0.1:${port}`, "Connection: close"]);
  expect(statusOf(response)).toBe(500);
  expect(response).toContain(CONTENT_SECURITY_POLICY);
  expect(response.toLowerCase()).toContain("x-content-type-options: nosniff");
});

test("un handler che fallisce è un 500 nel log, non solo a schermo", async () => {
  const messages: string[] = [];
  const { origin, store } = startTestServer({ logger: (message) => messages.push(message) });
  // Il database non risponde più: `store.records` solleva dentro l'handler.
  store.close();

  const response = await fetch(`${origin}/records?limit=1`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ detail: "internal error" });
  expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
  // Hono intercetta da sé gli errori degli handler: senza `app.onError` questa
  // riga non arrivava né al logger né a `backend.log` (I13).
  expect(messages.join("\n")).toContain("internal error");
});
