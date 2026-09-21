import type {
  AggregatePoint,
  Availability,
  CapacityRecord,
  DataQuality,
  CredentialPayload,
  CredentialStatus,
  DatasetName,
  GroupBy,
  HealthStatus,
  MetadataOptions,
  RecordFilters,
  Summary,
  SyncJobResponse,
  SyncJobStatus,
  SyncRequest,
  TimeseriesOptions,
} from "@/types";

declare global {
  interface Window {
    __TERNA_API_BASE__?: string;
  }
}

/**
 * Base URL dell'API.
 *
 * Nella modalità normale la SPA è servita *dallo stesso server* che espone
 * l'API, quindi basta un percorso relativo: niente porta da scoprire, niente
 * CORS, niente eccezioni CSP. `window.__TERNA_API_BASE__` resta supportato per
 * uno shell esterno, e `VITE_API_BASE_URL` per puntare altrove in sviluppo.
 */
export function apiBase(): string {
  if (typeof window !== "undefined" && window.__TERNA_API_BASE__) {
    return window.__TERNA_API_BASE__;
  }
  return (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
}

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** Come `request`, ma restituisce anche le intestazioni (per `x-total-count`). */
async function requestWithMeta<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  const data = await fetchJson<T>(path, init, true);
  return data as { data: T; headers: Headers };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return (await fetchJson<T>(path, init, false)) as T;
}

async function fetchJson<T>(
  path: string,
  init: RequestInit,
  withMeta: boolean,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    throw new ApiError(
      0,
      "The local data service is not responding. If the app was just opened, give it a few seconds and try again.",
      err,
    );
  }

  if (!response.ok) {
    let detail: unknown = undefined;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    const message =
      (detail && typeof detail === "object" && "detail" in detail
        ? String((detail as { detail: unknown }).detail)
        : response.statusText) || `Request failed (${response.status})`;
    throw new ApiError(response.status, message, detail);
  }

  if (response.status === 204) return withMeta ? { data: undefined, headers: response.headers } : undefined;

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? ((await response.json()) as T)
    : ((await response.text()) as unknown as T);
  return withMeta ? { data, headers: response.headers } : data;
}

function buildQuery(filters: Partial<RecordFilters>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  const str = params.toString();
  return str ? `?${str}` : "";
}

export const api = {
  health(): Promise<HealthStatus> {
    return request<HealthStatus>("/health");
  },

  credentialStatus(): Promise<CredentialStatus> {
    return request<CredentialStatus>("/settings/credentials/status");
  },

  saveCredentials(payload: CredentialPayload): Promise<CredentialStatus> {
    return request<CredentialStatus>("/settings/credentials", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteCredentials(): Promise<CredentialStatus> {
    return request<CredentialStatus>("/settings/credentials", { method: "DELETE" });
  },

  testCredentials(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/settings/credentials/test", { method: "POST" });
  },

  startSync(req: SyncRequest): Promise<SyncJobResponse> {
    return request<SyncJobResponse>("/sync/jobs", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  syncStatus(jobId: string): Promise<SyncJobStatus> {
    return request<SyncJobStatus>(`/sync/jobs/${encodeURIComponent(jobId)}`);
  },

  metadataOptions(): Promise<MetadataOptions> {
    return request<MetadataOptions>("/metadata/options");
  },

  availability(): Promise<Availability> {
    return request<Availability>("/metadata/availability");
  },

  dataQuality(filters: Partial<RecordFilters> = {}): Promise<DataQuality> {
    return request<DataQuality>(`/metadata/data-quality${buildQuery(filters)}`);
  },

  records(filters: Partial<RecordFilters> = {}): Promise<CapacityRecord[]> {
    return request<CapacityRecord[]>(`/records${buildQuery(filters)}`);
  },

  /**
   * Una pagina di record con il conteggio totale della selezione: ricerca,
   * ordinamento e ritaglio li fa il database.
   */
  recordsPage(
    filters: Partial<RecordFilters> = {},
    limit = 50,
    offset = 0,
    sort: { column: string; direction: "asc" | "desc"; q?: string } = { column: "year", direction: "desc" },
  ): Promise<{ rows: CapacityRecord[]; total: number }> {
    const query = buildQuery(filters);
    const separator = query ? "&" : "?";
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      sort: sort.column,
      order: sort.direction,
    });
    if (sort.q) params.set("q", sort.q);
    return requestWithMeta<CapacityRecord[]>(`/records${query}${separator}${params.toString()}`).then(
      (response) => ({
        rows: response.data,
        total: Number(response.headers.get("x-total-count") ?? response.data.length),
      }),
    );
  },

  summary(filters: Partial<RecordFilters> = {}): Promise<Summary> {
    return request<Summary>(`/analytics/summary${buildQuery(filters)}`);
  },

  timeseries(
    group_by: GroupBy,
    filters: Partial<RecordFilters> = {},
    opts: TimeseriesOptions = {},
  ): Promise<AggregatePoint[]> {
    const q = buildQuery(filters);
    const params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
    params.set("group_by", group_by);
    if (opts.latest_only) params.set("latest_only", "true");
    return request<AggregatePoint[]>(`/analytics/timeseries?${params.toString()}`);
  },

  exportCsv(filters: Partial<RecordFilters> = {}): Promise<string> {
    return request<string>(`/export/csv${buildQuery(filters)}`);
  },
};

export const DATASET_LABELS: Record<DatasetName, string> = {
  renewable_source_capacity: "Renewable source capacity",
  generation_plants: "Generation plants",
  installed_capacity: "Installed capacity (national)",
  thermoelectric_capacity: "Thermoelectric capacity",
};
