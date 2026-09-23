/**
 * Client della Terna Developer API: token OAuth2, pacing, retry.
 * Porting fedele di `backend/src/terna_backend/terna_client.py`.
 */
import { setTimeout as sleep } from "node:timers/promises";

const TOKEN_URL = "https://api.terna.it/public-api/access-token";
const BASE_URL = "https://api.terna.it/generation/v2.0";

/**
 * Terna limita le chiamate a ~1 al secondo e risponde `403 Developer Over Qps`
 * quando due richieste cadono nello stesso secondo (verificato con le chiavi
 * reali, con `retry-after: 1`). Il margine tiene conto che la finestra è
 * allineata ai secondi dell'orologio, non ai nostri intervalli.
 */
const MAX_REQUEST_INTERVAL = 10;

/**
 * L'intervallo minimo arriva già calcolato oppure come funzione da valutare
 * alla costruzione del client: `server/client.ts` passa `MIN_REQUEST_INTERVAL`,
 * che è una funzione.
 */
export type MinRequestInterval = number | (() => number);

/**
 * Intervallo minimo fra due richieste, letto dall'ambiente **al primo uso** e
 * non all'import: a livello di modulo il calcolo cadeva prima che la CLI
 * installasse il ponte di `console` (`server/cli.ts`), quindi l'avviso su un
 * valore fuori scala finiva su una console che non esiste e non in
 * `backend.log`. Il valore si calcola una volta sola: l'ambiente non cambia a
 * processo avviato e l'avviso non deve ripetersi a ogni client.
 */
let minRequestIntervalValue: number | null = null;

export function MIN_REQUEST_INTERVAL(): number {
  if (minRequestIntervalValue === null) minRequestIntervalValue = readMinRequestInterval();
  return minRequestIntervalValue;
}

function readMinRequestInterval(): number {
  const raw = process.env.TERNA_MIN_REQUEST_INTERVAL;
  // `Number(raw) || 1.2` trasformava uno 0 esplicito (utile nei test) in 1,2.
  if (raw === undefined || raw.trim() === "") return 1.2;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1.2;
  // Oltre dieci secondi fra due richieste il sync non finirebbe più: il tetto
  // vale come il pavimento, e l'avviso dice che il valore dichiarato è stato
  // ignorato (la CLI lo scrive in `backend.log`).
  if (parsed > MAX_REQUEST_INTERVAL) {
    console.warn(
      `TERNA_MIN_REQUEST_INTERVAL=${raw} exceeds the ${MAX_REQUEST_INTERVAL}s ceiling: using ${MAX_REQUEST_INTERVAL}`,
    );
    return MAX_REQUEST_INTERVAL;
  }
  return parsed;
}

/**
 * Oltre al limite per secondo c'è una quota più ampia (`403 Developer Over
 * Rate`): quando scatta, ritentare subito non serve. Il client mette in pausa
 * *tutte* le richieste finché la finestra non si riapre, invece di bruciare i
 * tentativi uno per uno.
 */
const RATE_COOLDOWN_SECONDS = 60;
const MAX_RATE_COOLDOWN_SECONDS = 600;
const MAX_RETRIES = 5;
const BACKOFF_SECONDS = [2, 4, 8, 15, 30];
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Un 401 che sopravvive alla riautenticazione non è un token scaduto: le
 * credenziali sono state rifiutate. Il messaggio dice cosa fare, perché è
 * quello che l'interfaccia mostra all'utente.
 */
const UNAUTHORIZED_MESSAGE =
  "401 Unauthorized — the credentials were rejected (check them in Credentials)";

export class TernaApiError extends Error {
  /**
   * Stato HTTP della risposta che ha prodotto l'errore (`null` per un guasto di
   * trasporto o un corpo illeggibile). Serve a distinguere un 401 dagli altri
   * errori senza leggere il testo del messaggio.
   */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

const HTML_TAG = /<[^>]+>/g;
const WHITESPACE = /\s+/g;

/** Terna risponde con pagine HTML agli errori: vanno ripulite per la UI. */
export function cleanErrorBody(text: string, limit = 300): string {
  return (text || "")
    .replace(HTML_TAG, " ")
    .replace(WHITESPACE, " ")
    .trim()
    .slice(0, limit);
}

/**
 * Le sole frasi con cui Terna annuncia un limite di richieste: `Developer Over
 * Qps` (finestra di un secondo) e `Developer Over Rate` (quota ampia). La
 * sottostringa nuda `"over"` classificava come rate-limit qualunque 403 il cui
 * corpo la contenesse — per esempio "overview" — trasformando un rifiuto
 * definitivo in sei tentativi e un minuto di pausa. I confini di parola tengono
 * le varianti senza pescare mezze parole.
 */
const RATE_LIMIT_MARKERS: readonly RegExp[] = [
  /\bover\s+qps\b/,
  /\bover\s+rate\b/,
  /\bqps\b/,
  /\brate\s+limit\b/,
  /\btoo\s+many\b/,
];

function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const marker = body.toLowerCase();
  return RATE_LIMIT_MARKERS.some((pattern) => pattern.test(marker));
}

/**
 * `Retry-After` ha due forme (RFC 9110): i secondi (`120`) o una data HTTP
 * (`Wed, 21 Oct 2015 07:28:00 GMT`). Terna usa la prima, ma un proxy davanti
 * può usare la seconda: senza `Date.parse` la data finiva in `Number(...)` =
 * `NaN` e la pausa diventava il backoff normale, ignorando quanto chiedeva il
 * server. `null` = header assente o illeggibile.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.max(0, (when - Date.now()) / 1000);
}

/**
 * `Developer Over Qps` è il limite per secondo e si supera aspettando un
 * secondo; `Developer Over Rate` è la quota ampia e chiede una pausa lunga.
 * Un 429 generico resta nel percorso normale (backoff + `retry-after`).
 */
function isBroadQuota(status: number, body: string): boolean {
  if (status !== 403) return false;
  const marker = body.toLowerCase();
  return marker.includes("over rate") || marker.includes("quota");
}

interface Token {
  accessToken: string;
  expiresAt: number;
}

interface RequestOptions {
  params?: Record<string, string | number | null | undefined>;
  headers?: Record<string, string>;
  form?: Record<string, string>;
}

export class TernaClient {
  private token: Token | null = null;
  private lastRequestAt = 0;
  /** Finestra di silenzio dopo una quota esaurita: vale per ogni richiesta. */
  private cooldownUntil = 0;
  private cooldownSeconds = 0;
  private readonly rateCooldownSeconds: number;
  private readonly maxRateCooldownSeconds: number;
  private readonly tokenUrl: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** Pausa fra due richieste, risolta alla costruzione (vedi il costruttore). */
  private readonly minRequestInterval: number;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    /**
     * Numero o funzione: `server/client.ts` passa `MIN_REQUEST_INTERVAL`, la
     * cui valutazione (avviso compreso) deve cadere **qui**, a runtime, quando
     * il ponte di `console` della CLI è già installato.
     */
    minRequestInterval: MinRequestInterval = MIN_REQUEST_INTERVAL,
    // Seam di test: gli endpoint, il transport e le pause sono sostituibili senza rete.
    options: {
      tokenUrl?: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
      rateCooldownSeconds?: number;
      maxRateCooldownSeconds?: number;
    } = {},
  ) {
    this.minRequestInterval = typeof minRequestInterval === "function" ? minRequestInterval() : minRequestInterval;
    this.tokenUrl = options.tokenUrl ?? TOKEN_URL;
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.rateCooldownSeconds = options.rateCooldownSeconds ?? RATE_COOLDOWN_SECONDS;
    this.maxRateCooldownSeconds = options.maxRateCooldownSeconds ?? MAX_RATE_COOLDOWN_SECONDS;
  }

  async testCredentials(): Promise<boolean> {
    await this.getToken(true);
    return true;
  }

  renewableSourceCapacity(params: {
    year: number;
    source?: string | null;
    capacity_type?: string | null;
  }): Promise<Record<string, unknown>> {
    return this.get("/renewable-source-capacity", {
      year: params.year,
      source: params.source,
      capacityType: params.capacity_type,
    });
  }

  generationPlants(params: {
    year: number;
    source?: string | null;
    capacity_type?: string | null;
  }): Promise<Record<string, unknown>> {
    return this.get("/generation-plants", {
      year: params.year,
      source: params.source,
      capacityType: params.capacity_type,
    });
  }

  installedCapacity(params: { year: number; type?: string | null }): Promise<Record<string, unknown>> {
    return this.get("/installed-capacity", { year: params.year, type: params.type });
  }

  thermoelectricCapacity(params: {
    year: number;
    capacity_type?: string | null;
    category?: string | null;
    subcategory?: string | null;
  }): Promise<Record<string, unknown>> {
    return this.get("/thermoelectric-capacity", {
      year: params.year,
      capacityType: params.capacity_type,
      category: params.category,
      subcategory: params.subcategory,
    });
  }

  /** Dorme finché la quota ampia non si riapre; la pausa cresce a ogni colpo. */
  private async waitForCooldown(): Promise<void> {
    const remaining = this.cooldownUntil - Date.now();
    if (remaining > 0) await sleep(remaining);
  }

  private startCooldown(retryAfterSeconds: number | null): void {
    this.cooldownSeconds = Math.min(
      this.maxRateCooldownSeconds,
      Math.max(this.rateCooldownSeconds, this.cooldownSeconds * 2),
    );
    const seconds = Number.isFinite(retryAfterSeconds as number)
      ? Math.max(this.cooldownSeconds, retryAfterSeconds as number)
      : this.cooldownSeconds;
    this.cooldownUntil = Date.now() + Math.min(this.maxRateCooldownSeconds, seconds) * 1000;
  }

  private async throttle(): Promise<void> {
    if (this.minRequestInterval <= 0) return;
    const elapsed = (performance.now() - this.lastRequestAt) / 1000;
    const wait = this.minRequestInterval - elapsed;
    if (wait > 0) await sleep(wait * 1000);
    this.lastRequestAt = performance.now();
  }

  private async requestWithRetries(method: string, url: string, options: RequestOptions): Promise<Response> {
    let lastError = "unknown error";
    let lastStatus: number | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.waitForCooldown();
      await this.throttle();
      let response: Response | null = null;
      let retryAfter: string | null = null;

      let body = "";
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: options.headers,
          body: options.form ? new URLSearchParams(options.form).toString() : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        // La lettura del corpo può fallire a metà (connessione interrotta):
        // dentro il try diventa un errore ritentabile invece di sfuggire.
        body = await response.text();
      } catch (error) {
        lastError = `network error: ${(error as Error).name}`;
        response = null;
      }

      if (response) {
        if (response.status < 400) {
          return new Response(body, { status: response.status, headers: response.headers });
        }
        lastError = `${response.status} ${cleanErrorBody(body)}`;
        lastStatus = response.status;
        const retryable = isRateLimited(response.status, body) || response.status >= 500;
        if (!retryable) throw new TernaApiError(`Terna API request failed: ${lastError}`, response.status);
        retryAfter = response.headers.get("retry-after");
        if (isBroadQuota(response.status, body)) {
          // Quota ampia esaurita: si aspetta la finestra, non i pochi secondi
          // del backoff normale.
          this.startCooldown(parseRetryAfter(retryAfter));
        }
      }

      if (attempt >= MAX_RETRIES) break;
      const fallback = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
      const parsedRetry = parseRetryAfter(retryAfter);
      const delay = parsedRetry === null ? fallback : Math.min(60, Math.max(1, parsedRetry));
      await sleep(delay * 1000);
    }

    throw new TernaApiError(
      `Terna API request failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
      lastStatus,
    );
  }

  private async get(path: string, params: Record<string, string | number | null | undefined>): Promise<Record<string, unknown>> {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") clean[key] = String(value);
    }
    const query = new URLSearchParams(clean).toString();
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
    const fetchWith = (token: Token) =>
      this.requestWithRetries("GET", url, {
        headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "Application/Json" },
      });

    const token = await this.getToken();
    let response: Response;
    try {
      response = await fetchWith(token);
    } catch (error) {
      if (!(error instanceof TernaApiError) || error.status !== 401) throw error;
      // Un 401 con un token che credevamo valido significa che è stato revocato
      // o che l'orologio ci ha ingannati: si riautentica **una volta forzando**
      // la cache e si ritenta il passo una volta sola. Se anche il token nuovo
      // viene rifiutato, sono le credenziali a essere sbagliate e insistere non
      // le aggiusta: l'errore lo dice, invece di ripetere un "401" nudo.
      const fresh = await this.getToken(true).catch((authError: unknown) => {
        // Anche il token endpoint che rifiuta le credenziali è lo stesso caso:
        // l'errore del passo deve dire cosa controllare, non ripetere un 401.
        if (authError instanceof TernaApiError && authError.status === 401) {
          throw new TernaApiError(UNAUTHORIZED_MESSAGE, 401);
        }
        throw authError;
      });
      try {
        response = await fetchWith(fresh);
      } catch (retryError) {
        if (retryError instanceof TernaApiError && retryError.status === 401) {
          throw new TernaApiError(UNAUTHORIZED_MESSAGE, 401);
        }
        throw retryError;
      }
    }
    const text = await response.text();
    if (!text.trim()) {
      // Terna risponde con corpo vuoto (non un errore) per valori o anni senza
      // dati: per il sync significa "nessuna riga", non un fallimento.
      return {};
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TernaApiError("Terna API returned a non-JSON response");
    }
  }

  private async getToken(force = false): Promise<Token> {
    const now = Date.now() / 1000;
    if (!force && this.token && this.token.expiresAt - 30 > now) return this.token;

    const response = await this.requestWithRetries("POST", this.tokenUrl, {
      form: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
      },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const text = await response.text();
    let payload: { access_token?: string; expires_in?: number };
    try {
      payload = JSON.parse(text) as { access_token?: string; expires_in?: number };
    } catch {
      throw new TernaApiError("Terna token response was not valid JSON");
    }
    if (!payload.access_token) {
      throw new TernaApiError("Terna token response did not contain access_token");
    }
    this.token = {
      accessToken: payload.access_token,
      expiresAt: now + Number(payload.expires_in ?? 300),
    };
    return this.token;
  }
}
