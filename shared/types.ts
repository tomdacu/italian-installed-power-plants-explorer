/**
 * Contratto dati condiviso fra server e SPA: una sola fonte di verità per i
 * tipi che prima erano duplicati (`backend/schemas.py` + `src/types/index.ts`).
 */

export const DATASETS = [
  "renewable_source_capacity",
  "generation_plants",
  "installed_capacity",
  "thermoelectric_capacity",
] as const;
export type DatasetName = (typeof DATASETS)[number];

export const CAPACITY_TYPES = ["Lorda", "Netta"] as const;
export type CapacityType = (typeof CAPACITY_TYPES)[number];

export type GroupBy =
  | (typeof GROUP_BY_FIELDS)[number]
  | "year,source"
  | "year,type"
  | "year,region"
  | "year,province"
  | "year,capacity_type"
  | "region,source"
  | "region,type"
  | "province,source"
  | "province,type";

export const GROUP_BY_FIELDS = [
  "year",
  "region",
  "province",
  "source",
  "capacity_type",
  "category",
  "subcategory",
  "type",
] as const;

export interface RecordFilters {
  dataset?: DatasetName | null;
  year_from?: number | null;
  year_to?: number | null;
  region?: string | null;
  province?: string | null;
  source?: string | null;
  capacity_type?: CapacityType | "" | null;
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
  /** Ricerca libera su dimensioni e anno (LIKE, case-insensitive per ASCII). */
  q?: string | null;
}

export interface CapacityRecord {
  dataset: string;
  year: number;
  capacity_type: string | null;
  region: string | null;
  province: string | null;
  source: string | null;
  category: string | null;
  subcategory: string | null;
  type: string | null;
  efficient_power_mw: number | null;
  installed_capacity_gw: number | null;
  fetched_at: string;
}

export interface Summary {
  row_count: number;
  year_min: number | null;
  year_max: number | null;
  latest_year: number | null;
  latest_total_efficient_power_mw: number | null;
  latest_total_installed_capacity_gw: number | null;
  previous_year: number | null;
  previous_total_efficient_power_mw: number | null;
  yoy_new_mw: number | null;
  yoy_new_gw: number | null;
  yoy_pct: number | null;
  capacity_type_applied: string | null;
}

export interface AggregatePoint {
  year: number | null;
  region: string | null;
  province: string | null;
  source: string | null;
  capacity_type: string | null;
  category: string | null;
  subcategory: string | null;
  type: string | null;
  efficient_power_mw: number | null;
  installed_capacity_gw: number | null;
}

export interface HealthStatus {
  status: string;
}

export interface CredentialStatus {
  configured: boolean;
  client_id_suffix: string | null;
}

export type SyncStatus = "queued" | "running" | "completed" | "failed";

export interface SyncRequestPayload {
  years: number[];
  datasets?: DatasetName[];
}

export interface SyncJobResponse {
  job_id: string;
  status: SyncStatus;
}

export interface SyncJobStatus {
  job_id: string;
  status: SyncStatus;
  total_steps: number;
  completed_steps: number;
  message: string;
  error: string | null;
  failed_steps: number;
  empty_steps: number;
  /** Passi saltati perché quel dataset non pubblica quell'anno (es. il nazionale prima del 2021). */
  skipped_steps: number;
}

export interface AvailabilityYear {
  year: number;
  rows: number;
  sources: string[];
  capacity_types: string[];
}

export interface AvailabilityDataset {
  years: AvailabilityYear[];
  total_rows: number;
  year_min: number | null;
  year_max: number | null;
  last_fetched: string | null;
}

export interface DataQualityYear {
  year: number;
  /** Cells the source left empty even though the same key has a value elsewhere. */
  missing_values: number;
}

export interface Availability {
  datasets: Partial<Record<DatasetName, AvailabilityDataset>>;
  total_rows: number;
}

export interface MetadataOptions {
  known_sources: string[];
  known_generation_plant_sources: string[];
  known_installed_capacity_types: string[];
  known_capacity_types: string[];
  dataset_sources: Partial<Record<DatasetName, string[]>>;
  default_capacity_type: CapacityType;
  /** Primo anno pubblicato (2000) e limiti per dataset, condivisi con la UI. */
  first_year: number;
  installed_capacity_first_year: number;
  current_year: number;
  database: {
    datasets?: string[];
    years?: number[];
    regions?: string[];
    provinces?: string[];
    sources?: string[];
    capacity_types?: string[];
    categories?: string[];
    subcategories?: string[];
    /** Provincia → regione, per filtrare i menu l'uno con l'altro. */
    province_region?: Record<string, string>;
    types?: string[];
  };
}
