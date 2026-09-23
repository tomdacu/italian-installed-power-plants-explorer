/**
 * API HTTP locale: le stesse URL e le stesse forme di risposta della versione
 * Python (`backend/src/terna_backend/api.py`), così la SPA non cambia.
 *
 * Qui resta solo l'assemblaggio del router: il gestore degli errori interni, il
 * 404 JSON e la registrazione dei due gruppi di rotte (`api-read.ts` per la
 * lettura, `api-sync.ts` per credenziali e job). Il supporto condiviso — filtri
 * di query, lettura del corpo JSON, riga di log dei guasti — sta in
 * `api-support.ts`.
 */
import { Hono } from "hono";

import { registerReadRoutes } from "./api-read.ts";
import { registerSyncRoutes } from "./api-sync.ts";
import { logInternalError, type ApiDependencies } from "./api-support.ts";

// La riga dei guasti interni resta importabile da qui: `server/http.ts` la usa
// per gli errori fuori dagli handler, e il modulo pubblico è questo.
export { logInternalError } from "./api-support.ts";

export function createApi({ store, settings, sync, logger, serverInfo }: ApiDependencies): Hono {
  const app = new Hono();
  const dependencies: ApiDependencies = { store, settings, sync, logger, serverInfo };

  // Un handler che fallisce (per esempio il database che non risponde) è un
  // guasto interno come gli altri: stessa risposta JSON e stessa riga di log.
  app.onError((error, c) => {
    logInternalError(error, logger);
    return c.json({ detail: "internal error" }, 500);
  });

  // Senza questo, una rotta API inesistente riceveva il 404 predefinito di Hono,
  // in `text/plain`: il commento del server promette JSON dappertutto. Gli header
  // di sicurezza li aggiunge comunque `withSecurityHeaders` in `server/http.ts`.
  app.notFound((c) => c.json({ detail: "Not found" }, 404));

  registerReadRoutes(app, dependencies);
  registerSyncRoutes(app, dependencies);

  return app;
}
