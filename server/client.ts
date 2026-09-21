/**
 * Unico posto che sa come costruire un client Terna dalle credenziali salvate.
 * Prima questa sequenza (leggi le impostazioni, prendi il secret, rifiuta se
 * manca, costruisci il client) era scritta due volte — qui e nelle rotte API.
 */
import type { SettingsStore } from "./settings.ts";
import { MIN_REQUEST_INTERVAL, TernaApiError, TernaClient } from "./terna.ts";

export async function createTernaClient(settings: SettingsStore): Promise<TernaClient> {
  const current = settings.load();
  const secret = await settings.getClientSecret(current.clientId ?? undefined);
  if (!current.clientId || !secret) {
    throw new TernaApiError("Terna credentials are not configured");
  }
  return new TernaClient(current.clientId, secret, MIN_REQUEST_INTERVAL);
}
