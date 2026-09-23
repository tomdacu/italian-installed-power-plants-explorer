import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { TernaApiError, TernaClient, cleanErrorBody } from "../server/terna.ts";

const TOKEN_URL = "https://terna.test/access-token";
const BASE_URL = "https://terna.test/generation/v2.0";

interface Stub {
  calls: number;
  /** Richieste al token endpoint: la riautenticazione forzata si vede da qui. */
  tokenCalls: number;
  fetch: typeof fetch;
}

/** Endpoint finti: nessuna rete, stessa forma delle risposte Terna. */
function stub(handler: (url: string, call: number) => Response): Stub {
  const state: Stub = {
    calls: 0,
    tokenCalls: 0,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(TOKEN_URL)) {
        state.tokenCalls += 1;
        return Response.json({ access_token: "token-di-prova", expires_in: 300 });
      }
      state.calls += 1;
      return handler(url, state.calls);
    }) as typeof fetch,
  };
  return state;
}

function client(transport: Stub, options: { rateCooldownSeconds?: number } = {}): TernaClient {
  return new TernaClient("id", "secret", 0, {
    tokenUrl: TOKEN_URL,
    baseUrl: BASE_URL,
    fetchImpl: transport.fetch,
    rateCooldownSeconds: options.rateCooldownSeconds,
    maxRateCooldownSeconds: options.rateCooldownSeconds,
  });
}

test("riprova sui limiti di rate e poi riesce", async () => {
  const transport = stub((_url, call) =>
    call < 3
      ? new Response("<h1>Developer Over Qps</h1>", { status: 403 })
      : Response.json({ installed_capacity: [] }),
  );

  const payload = await client(transport).installedCapacity({ year: 2024 });

  expect(payload).toEqual({ installed_capacity: [] });
  expect(transport.calls).toBe(3);
}, 20_000);

test("un errore non ritentabile fallisce subito e ripulisce l'HTML", async () => {
  const transport = stub(() => new Response("<html>Forbidden</html>", { status: 403 }));

  const error = await client(transport)
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(error).toBeInstanceOf(TernaApiError);
  expect(error?.message).toContain("Forbidden");
  expect(error?.message).not.toContain("<html>");
  expect(transport.calls).toBe(1);
});

test("un 403 con la sola parola 'over' non è un limite di rate", async () => {
  // Pre-fix la sottostringa nuda `"over"` bastava: un corpo come questo veniva
  // ritentato sei volte con un minuto di pausa, per un rifiuto definitivo.
  const transport = stub(
    () => new Response("<html><h1>Overview</h1>La overview non è disponibile per queste chiavi</html>", { status: 403 }),
  );

  const error = await client(transport)
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(error).toBeInstanceOf(TernaApiError);
  expect(error?.message).toContain("Overview");
  expect(transport.calls).toBe(1);
});

test("le altre frasi di rate-limit restano ritentabili", async () => {
  const transport = stub((_url, call) =>
    call < 2
      ? new Response("<h1>Too Many Requests</h1>", { status: 403, headers: { "retry-after": "1" } })
      : Response.json({ installed_capacity: [] }),
  );

  expect(await client(transport).installedCapacity({ year: 2024 })).toEqual({ installed_capacity: [] });
  expect(transport.calls).toBe(2);
}, 20_000);

test("un 401 riautentica una volta e ritenta il passo", async () => {
  const transport = stub((_url, call) =>
    call === 1
      ? new Response("<html>Unauthorized</html>", { status: 401 })
      : Response.json({ installed_capacity: [] }),
  );

  const payload = await client(transport).installedCapacity({ year: 2024 });

  expect(payload).toEqual({ installed_capacity: [] });
  // Un tentativo rifiutato, uno riuscito: il passo si ripete una volta sola.
  expect(transport.calls).toBe(2);
  // Il token viene chiesto di nuovo **forzando** la cache: è la riautenticazione.
  expect(transport.tokenCalls).toBe(2);
});

test("un 401 che resta 401 accusa le credenziali invece di insistere", async () => {
  const transport = stub(() => new Response("<html>Unauthorized</html>", { status: 401 }));

  const error = await client(transport)
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(error).toBeInstanceOf(TernaApiError);
  expect((error as TernaApiError).status).toBe(401);
  expect(error?.message).toContain("credentials were rejected");
  expect(transport.calls).toBe(2); // nessun terzo tentativo
  expect(transport.tokenCalls).toBe(2);
});

test("se è la riautenticazione a essere rifiutata, l'errore nomina le credenziali", async () => {
  // La prima coppia di credenziali viene accettata, la seconda no: è il caso
  // "revocate nel frattempo", e deve finire nello stesso messaggio.
  let tokens = 0;
  const transport = (async (input: RequestInfo | URL) => {
    if (String(input).startsWith(TOKEN_URL)) {
      tokens += 1;
      return tokens === 1
        ? Response.json({ access_token: "token-di-prova", expires_in: 300 })
        : new Response("Unauthorized", { status: 401 });
    }
    return new Response("<html>Unauthorized</html>", { status: 401 });
  }) as typeof fetch;
  const instance = new TernaClient("id", "secret", 0, {
    tokenUrl: TOKEN_URL,
    baseUrl: BASE_URL,
    fetchImpl: transport,
  });

  const error = await instance
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(error).toBeInstanceOf(TernaApiError);
  expect(error?.message).toContain("credentials were rejected");
  expect(tokens).toBe(2);
});

test("Retry-After in secondi decide la pausa", async () => {
  const transport = stub((_url, call) =>
    call < 2
      ? new Response("Too Many Requests", { status: 429, headers: { "retry-after": "3" } })
      : Response.json({ installed_capacity: [] }),
  );

  const started = Date.now();
  await client(transport).installedCapacity({ year: 2024 });

  expect(transport.calls).toBe(2);
  // 3 secondi chiesti dal server, non i 2 del backoff di riserva (BACKOFF_SECONDS[0]).
  expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
}, 20_000);

test("Retry-After in forma di data HTTP decide la pausa", async () => {
  // `Wed, 21 Oct 2015 07:28:00 GMT` non è un numero: senza `Date.parse` la
  // pausa diventava il backoff di riserva (2 s) e il server veniva ignorato.
  const transport = stub((_url, call) =>
    call < 2
      ? new Response("Too Many Requests", {
          status: 429,
          headers: { "retry-after": new Date(Date.now() + 4000).toUTCString() },
        })
      : Response.json({ installed_capacity: [] }),
  );

  const started = Date.now();
  await client(transport).installedCapacity({ year: 2024 });

  expect(transport.calls).toBe(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(2800);
}, 20_000);

test("insiste fino al numero massimo di tentativi", async () => {
  const transport = stub(() => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "1" } }));

  const error = await client(transport)
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(transport.calls).toBe(6); // tentativo iniziale + 5 retry
  expect(error?.message).toContain("attempts");
}, 20_000);

test("sulla quota ampia mette in pausa tutte le richieste invece di insistere", async () => {
  const transport = stub(() => new Response("<h1>Developer Over Rate</h1>", { status: 403, headers: { "retry-after": "0" } }));

  const started = Date.now();
  await client(transport, { rateCooldownSeconds: 0.4 })
    .installedCapacity({ year: 2024 })
    .catch(() => null);
  const elapsed = Date.now() - started;

  // Sei tentativi, ognuno preceduto dalla pausa: senza cooldown sarebbero
  // immediati (il test dello di 429 qui sopra dura ~1s).
  expect(transport.calls).toBe(6);
  expect(elapsed).toBeGreaterThanOrEqual(5 * 400);
}, 20_000);

test("un corpo vuoto vale come 'nessun dato', non come errore", async () => {
  const transport = stub(() => new Response("", { status: 200 }));

  expect(await client(transport).installedCapacity({ year: 2026 })).toEqual({});
  expect(transport.calls).toBe(1);
});

test("il token viene riusato finché è valido", async () => {
  const transport = stub(() => Response.json({ installed_capacity: [] }));
  const instance = client(transport);

  await instance.installedCapacity({ year: 2024 });
  await instance.installedCapacity({ year: 2023 });

  expect(transport.calls).toBe(2);
});

test("cleanErrorBody toglie i tag e comprime gli spazi", () => {
  expect(cleanErrorBody("<h1>Developer\n   Over Qps</h1>")).toBe("Developer Over Qps");
});

/**
 * `MIN_REQUEST_INTERVAL` si calcola **al primo uso** e non più all'import:
 * nel processo nuovo va invocata (o costruito un client) perché l'ambiente del
 * figlio sia quello che si sta provando.
 */
async function intervalFor(raw: string): Promise<{ value: number; stderr: string }> {
  const module = pathToFileURL(join(import.meta.dir, "..", "server", "terna.ts")).href;
  const child = Bun.spawn(
    [process.execPath, "-e", `import(${JSON.stringify(module)}).then((m) => console.log(m.MIN_REQUEST_INTERVAL()));`],
    { env: { ...process.env, TERNA_MIN_REQUEST_INTERVAL: raw }, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await child.exited;
  return { value: Number(stdout.trim()), stderr };
}

test("TERNA_MIN_REQUEST_INTERVAL è limitato a 10 secondi, con un avviso", async () => {
  const huge = await intervalFor("1e9");

  expect(huge.value).toBe(10);
  expect(huge.stderr).toContain("TERNA_MIN_REQUEST_INTERVAL=1e9");
  expect(huge.stderr).toContain("ceiling");

  // Il pavimento: 0 resta legittimo (i test lo usano) e non produce avvisi.
  const zero = await intervalFor("0");
  expect(zero.value).toBe(0);
  expect(zero.stderr).not.toContain("ceiling");

  // Il default non cambia.
  expect((await intervalFor("")).value).toBe(1.2);
}, 30_000);
