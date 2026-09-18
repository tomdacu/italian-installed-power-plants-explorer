import type {
  AggregatePoint,
  Availability,
  CapacityRecord,
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
 * Resolved lazily on every request: inside the packaged Tauri app the Rust
 * shell picks a free port at startup and stores it in
 * `window.__TERNA_API_BASE__` (see src/main.tsx). In the browser we fall back
 * to the build-time value.
 */
export function apiBase(): string {
  return (
    (typeof window !== "undefined" && window.__TERNA_API_BASE__) ||
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    "http://127.0.0.1:8765"
  );
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

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
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

  records(filters: Partial<RecordFilters> = {}): Promise<CapacityRecord[]> {
    return request<CapacityRecord[]>(`/records${buildQuery(filters)}`);
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
