/**
 * Il supporto comune delle rotte HTTP: la riga dei guasti interni, la lettura
 * del corpo JSON, i filtri di query e il wrapper che li rende un 400.
 *
 * Vive in un modulo a parte perché le stesse righe servono a tre punti: il
 * router (`server/api.ts`), le rotte di lettura (`server/api-read.ts`) e quelle
 * di scrittura (`server/api-sync.ts`).
 */
import type { CapacityStore } from "./db.ts";
import type { SettingsStore } from "./settings.ts";
import type { SyncManager } from "./sync.ts";
import { CAPACITY_TYPES, DATASETS, type CapacityType, type DatasetName, type RecordFilters } from "../shared/types.ts";

export interface ApiDependencies {
  store: CapacityStore;
  settings: SettingsStore;
  sync: SyncManager;
  /** Dove finiscono i guasti interni: lo stesso `logger` del server. */
  logger?: (message: string) => void;
  /**
   * Porta effettiva e ripiego su una porta libera. È una funzione e non due
   * valori perché con `port: 0` la porta la sceglie il sistema operativo solo
   * dentro `Bun.serve`, cioè dopo che `createApi` è già stato costruito.
   */
  serverInfo: () => { port: number; port_fallback: boolean };
}

/**
 * La riga di un guasto interno, scritta **una volta sola**: la usano il gestore
 * `error` di `Bun.serve` (`server/http.ts`, per gli errori fuori dagli handler)
 * e `app.onError` qui sotto, perché Hono intercetta da sé gli errori degli
 * handler e senza `onError` non passerebbero mai né dal logger né da Bun.
 */
export function logInternalError(error: unknown, logger?: (message: string) => void): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (logger) logger(`internal error: ${detail}`);
  else console.error(error);
}

/** Corpo JSON non valido = 422 (il 400 è per i filtri di query), non un 500 con stack trace. */
export async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Errore di validazione di un filtro: rispondere con *tutto* quando il valore
 * non è riconosciuto (comportamento precedente) è peggio di un 400, perché
 * l'utente crede di aver filtrato e vede invece l'intero database.
 */
export class FilterError extends Error {}

/**
 * Oltre questa lunghezza la `q` non arrivava nemmeno ai validatori: la richiesta
 * falliva a livello di trasporto (505/reset) e il client parlava di «service non
 * rispondente». Un rifiuto esplicito è più utile di una connessione caduta.
 */
const MAX_QUERY_LENGTH = 200;

function filtersFromQuery(query: URLSearchParams): RecordFilters {
  const text = (key: string): string | null => {
    const value = query.get(key);
    return value === null || value === "" ? null : value;
  };
  const years = (key: string): number | null => {
    const value = text(key);
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new FilterError(`${key} must be an integer year`);
    return parsed;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fold = false): T | null => {
    const raw = text(key);
    if (raw === null) return null;
    const value = fold ? raw.toLowerCase() : raw;
    const match = fold ? allowed.find((candidate) => candidate.toLowerCase() === value) : allowed.find((candidate) => candidate === raw);
    if (!match) throw new FilterError(`${key} must be one of: ${allowed.join(", ")}`);
    return match;
  };

  const q = text("q");
  if (q !== null && q.length > MAX_QUERY_LENGTH) {
    throw new FilterError(`q must be at most ${MAX_QUERY_LENGTH} characters`);
  }

  return {
    dataset: oneOf<DatasetName>("dataset", DATASETS as readonly DatasetName[]),
    year_from: years("year_from"),
    year_to: years("year_to"),
    region: text("region"),
    province: text("province"),
    source: text("source"),
    // `capacity_type=netta` applicava in silenzio Lorda: ora il confronto non
    // distingue le maiuscole e un valore ignoto è un errore.
    capacity_type: oneOf<CapacityType>("capacity_type", CAPACITY_TYPES as readonly CapacityType[], true),
    category: text("category"),
    subcategory: text("subcategory"),
    type: text("type"),
    q,
  };
}

/**
 * Maschera un client id: restano solo le ultime quattro cifre, e un id che ne ha
 * quattro o meno viene coperto per intero (prima tornava in chiaro).
 */
export function maskClientId(clientId: string): string {
  if (clientId.length <= 4) return "*".repeat(clientId.length);
  return `${"*".repeat(clientId.length - 4)}${clientId.slice(-4)}`;
}

/** Context Hono ridotto a ciò che serve: il wrapper resta indipendente dai tipi del router. */
export interface FilterContext {
  req: { url: string };
  json: (body: unknown, status?: number, headers?: Record<string, string>) => Response;
}

/** Avvolge un handler: i filtri non validi diventano 400, non 500. */
export function withFilters(handler: (
  filters: RecordFilters,
  c: FilterContext,
  query: URLSearchParams,
) => Response | Promise<Response>) {
  return async (c: FilterContext) => {
    const query = new URL(c.req.url).searchParams;
    try {
      return await handler(filtersFromQuery(query), c, query);
    } catch (error) {
      if (error instanceof FilterError) return c.json({ detail: error.message }, 400);
      throw error;
    }
  };
}
