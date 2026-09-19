import { expect, test } from "bun:test";

import { TernaApiError, TernaClient, cleanErrorBody } from "../server/terna.ts";

const TOKEN_URL = "https://terna.test/access-token";
const BASE_URL = "https://terna.test/generation/v2.0";

interface Stub {
  calls: number;
  fetch: typeof fetch;
}

/** Endpoint finti: nessuna rete, stessa forma delle risposte Terna. */
function stub(handler: (url: string, call: number) => Response): Stub {
  const state: Stub = {
    calls: 0,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(TOKEN_URL)) {
        return Response.json({ access_token: "token-di-prova", expires_in: 300 });
      }
      state.calls += 1;
      return handler(url, state.calls);
    }) as typeof fetch,
  };
  return state;
}

function client(transport: Stub): TernaClient {
  return new TernaClient("id", "secret", 0, {
    tokenUrl: TOKEN_URL,
    baseUrl: BASE_URL,
    fetchImpl: transport.fetch,
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
  const transport = stub(() => new Response("<html>Unauthorized</html>", { status: 401 }));

  const error = await client(transport)
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(error).toBeInstanceOf(TernaApiError);
  expect(error?.message).toContain("Unauthorized");
  expect(error?.message).not.toContain("<html>");
  expect(transport.calls).toBe(1);
});

test("insiste fino al numero massimo di tentativi", async () => {
  const transport = stub(() => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "1" } }));

  const error = await client(transport)
    .installedCapacity({ year: 2024 })
    .then(() => null)
    .catch((caught: unknown) => caught as Error);

  expect(transport.calls).toBe(6); // tentativo iniziale + 5 retry
  expect(error?.message).toContain("attempts");
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
