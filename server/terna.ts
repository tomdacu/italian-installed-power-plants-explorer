/**
 * Client della Terna Developer API: token OAuth2, pacing, retry.
 * Porting fedele di `backend/src/terna_backend/terna_client.py`.
 */
import { setTimeout as sleep } from "node:timers/promises";

const TOKEN_URL = "https://api.terna.it/public-api/access-token";
const BASE_URL = "https://api.terna.it/generation/v2.0";

/** Terna impone una quota per secondo sulle chiavi developer. */
export const MIN_REQUEST_INTERVAL = Math.max(
  0,
  Number(process.env.TERNA_MIN_REQUEST_INTERVAL ?? "1.0") || 1.0,
);
const MAX_RETRIES = 5;
const BACKOFF_SECONDS = [2, 4, 8, 15, 30];
const REQUEST_TIMEOUT_MS = 30_000;

export class TernaApiError extends Error {}

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

function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const marker = body.toLowerCase();
  return marker.includes("qps") || marker.includes("over") || marker.includes("rate limit") || marker.includes("too many");
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
  private readonly tokenUrl: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly minRequestInterval: number = MIN_REQUEST_INTERVAL,
    // Seam di test: gli endpoint e il transport sono sostituibili senza rete.
    options: { tokenUrl?: string; baseUrl?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.tokenUrl = options.tokenUrl ?? TOKEN_URL;
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
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

  private async throttle(): Promise<void> {
    if (this.minRequestInterval <= 0) return;
    const elapsed = (performance.now() - this.lastRequestAt) / 1000;
    const wait = this.minRequestInterval - elapsed;
    if (wait > 0) await sleep(wait * 1000);
    this.lastRequestAt = performance.now();
  }

  private async requestWithRetries(method: string, url: string, options: RequestOptions): Promise<Response> {
    let lastError = "unknown error";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.throttle();
      let response: Response | null = null;
      let retryAfter: string | null = null;

      try {
        response = await this.fetchImpl(url, {
          method,
          headers: options.headers,
          body: options.form ? new URLSearchParams(options.form).toString() : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = `network error: ${(error as Error).name}`;
      }

      if (response) {
        const body = await response.text();
        if (response.status < 400) {
          return new Response(body, { status: response.status, headers: response.headers });
        }
        lastError = `${response.status} ${cleanErrorBody(body)}`;
        const retryable = isRateLimited(response.status, body) || response.status >= 500;
        if (!retryable) throw new TernaApiError(`Terna API request failed: ${lastError}`);
        retryAfter = response.headers.get("retry-after");
      }

      if (attempt >= MAX_RETRIES) break;
      const fallback = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
      const parsedRetry = retryAfter ? Number(retryAfter) : Number.NaN;
      const delay = Number.isFinite(parsedRetry) ? Math.min(60, Math.max(1, parsedRetry)) : fallback;
      await sleep(delay * 1000);
    }

    throw new TernaApiError(`Terna API request failed after ${MAX_RETRIES + 1} attempts: ${lastError}`);
  }

  private async get(path: string, params: Record<string, string | number | null | undefined>): Promise<Record<string, unknown>> {
    const token = await this.getToken();
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") clean[key] = String(value);
    }
    const query = new URLSearchParams(clean).toString();
    const response = await this.requestWithRetries("GET", `${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "Application/Json" },
    });
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
