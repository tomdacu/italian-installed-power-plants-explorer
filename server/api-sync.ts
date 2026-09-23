/**
 * Rotte che scrivono: credenziali Terna e job di sync.
 *
 * Sono le uniche che leggono un corpo JSON e che toccano lo stato del server;
 * le rotte di sola lettura stanno in `server/api-read.ts`.
 */
import type { Context, Hono } from "hono";

import { createTernaClient } from "./client.ts";
import { DATA_FIRST_YEAR, clampYears, currentYear } from "./constants.ts";
import type { SettingsStore } from "./settings.ts";
import { buildPlan, SYNCABLE_DATASETS } from "./sync.ts";
import { maskClientId, readJsonBody, type ApiDependencies } from "./api-support.ts";
import { DATASETS, type CredentialStatus, type DatasetName } from "../shared/types.ts";

/**
 * Le tre rotte del job scrivono lo stesso 404: la riga è scritta qui una volta
 * sola, così le tre risposte non possono divergere.
 */
function syncJobNotFound(c: Context): Response {
  return c.json({ detail: "Sync job not found" }, 404);
}

async function credentialStatus(settings: SettingsStore): Promise<CredentialStatus> {
  const current = settings.load();
  const clientId = current.clientId;
  return {
    configured: await settings.hasCredentials(),
    // Un id di 4 caratteri (o meno) non ha "ultime quattro cifre" da
    // mostrare: la maschera copre tutto l'id invece di restituirlo intero.
    client_id_suffix: clientId ? maskClientId(clientId) : null,
  };
}

export function registerSyncRoutes(app: Hono, { settings, sync }: ApiDependencies): void {
  app.get("/settings/credentials/status", async (c) => c.json(await credentialStatus(settings)));

  app.post("/settings/credentials", async (c) => {
    const body = await readJsonBody(c);
    if (typeof body?.client_id !== "string" || typeof body.client_secret !== "string") {
      return c.json({ detail: "client_id and client_secret are required" }, 422);
    }
    if (!body.client_id.trim() || !body.client_secret.trim()) {
      return c.json({ detail: "client_id and client_secret cannot be blank" }, 422);
    }
    await settings.saveCredentials(body.client_id.trim(), body.client_secret.trim());
    return c.json(await credentialStatus(settings));
  });

  app.delete("/settings/credentials", async (c) => {
    await settings.deleteCredentials();
    return c.json(await credentialStatus(settings));
  });

  app.post("/settings/credentials/test", async (c) => {
    try {
      const client = await createTernaClient(settings);
      await client.testCredentials();
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ detail: (error as Error).message }, 502);
    }
  });

  app.post("/sync/jobs", async (c) => {
    const body = (await readJsonBody(c)) as { years?: number[]; datasets?: DatasetName[] } | null;
    if (!body || !Array.isArray(body.years) || body.years.length === 0) {
      return c.json({ detail: "years must be a non-empty array" }, 422);
    }
    if (body.datasets !== undefined && !Array.isArray(body.datasets)) {
      return c.json({ detail: "datasets must be an array of dataset names" }, 422);
    }
    if (Array.isArray(body.datasets) && body.datasets.length === 0) {
      return c.json({ detail: "datasets cannot be empty when provided" }, 422);
    }
    if (Array.isArray(body.datasets)) {
      const unknown = body.datasets.filter((dataset) => !DATASETS.includes(dataset));
      if (unknown.length > 0) {
        return c.json({ detail: `unknown datasets: ${unknown.join(", ")}` }, 422);
      }
    }
    // Ogni voce deve essere un anno intero: `map(Number).filter(isFinite)`
    // faceva sparire `"abc"` (contata come zero anni) e trasformava `null` e
    // `true` in 0 e 1, cioè in anni che nessuno aveva chiesto. Il dettaglio
    // nomina la voce, così si sa quale correggere.
    const invalid = body.years.findIndex((year) => typeof year !== "number" || !Number.isInteger(year));
    if (invalid >= 0) {
      return c.json(
        { detail: `years[${invalid}] must be an integer year, got ${JSON.stringify(body.years[invalid])}` },
        422,
      );
    }
    // Stessa funzione che usa la UI: un intervallo assurdo (1900-2100) non può
    // trasformarsi in centinaia di richieste e bruciare la quota Terna.
    const { years, skipped } = clampYears(body.years);
    if (years.length === 0) {
      return c.json(
        { detail: `no year between ${DATA_FIRST_YEAR} and ${currentYear()} was requested` },
        422,
      );
    }
    // Il piano si costruisce **prima** di accodare il job: un rifiuto non deve
    // lasciare nella mappa un job che non è mai stato eseguito.
    const plan = buildPlan({ years, datasets: body.datasets });
    // Gli anni limati da `clampYears` sono passi mai eseguiti come quelli che un
    // dataset non pubblica: senza, `skipped_steps` restava a zero e il job
    // sembrava aver coperto un intervallo che non ha mai chiesto. `clampYears`
    // conta **anni**, il piano conta **passi**: un anno limato vale un passo per
    // ciascun dataset scelto, così `total_steps + skipped_steps` resta
    // `anni unici × dataset` (docs/api.md).
    plan.dropped += skipped * (body.datasets ?? SYNCABLE_DATASETS).length;
    // Un piano che non contiene nemmeno un passo (tutti gli anni sotto la soglia
    // del dataset scelto) non è un job: meglio dirlo subito che restituire un
    // "completed" che non ha scaricato niente.
    if (plan.steps.length === 0) {
      return c.json({ detail: "no step to run for the requested years and datasets" }, 422);
    }
    const jobId = sync.start(plan);
    return c.json({ job_id: jobId, status: "queued" });
  });

  app.get("/sync/jobs/latest", (c) => {
    const status = sync.latestStatus();
    if (!status) return syncJobNotFound(c);
    return c.json(status);
  });

  app.get("/sync/jobs/:jobId", (c) => {
    const status = sync.status(c.req.param("jobId"));
    if (!status) return syncJobNotFound(c);
    return c.json(status);
  });

  // Cancellazione: 200 con lo stato del job (idempotente — su un job già finito
  // risponde con lo stato che ha, senza inventare un esito), 404 se l'id è
  // ignoto. Lo stato è `cancelled` appena la richiesta è accettata: il passo in
  // volo finisce comunque, e i contatori restano quelli veri.
  app.delete("/sync/jobs/:jobId", (c) => {
    const status = sync.cancel(c.req.param("jobId"));
    if (!status) return syncJobNotFound(c);
    return c.json(status);
  });
}
