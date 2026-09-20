export type DatasetName =
  | "renewable_source_capacity"
  | "generation_plants"
  | "installed_capacity"
  | "thermoelectric_capacity";

export type GroupBy =
  | "year"
  | "region"
  | "province"
  | "source"
  | "capacity_type"
  | "category"
  | "subcategory"
  | "type"
  | "year,source"
  | "year,type"
  | "year,region"
  | "year,province"
  | "year,capacity_type";

export type CapacityType = "Lorda" | "Netta";

export interface RecordFilters {
  dataset?: DatasetName | "";
  year_from?: number | null;
  year_to?: number | null;
  region?: string | "";
  province?: string | "";
  source?: string | "";
  capacity_type?: CapacityType | "";
  category?: string | "";
  subcategory?: string | "";
  type?: string | "";
}

export interface TimeseriesOptions {
  latest_only?: boolean;
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
  total_efficient_power_mw: number | null;
  total_installed_capacity_gw: number | null;
  year_min: number | null;
  year_max: number | null;
  /** Stock of the latest year in the selection (single capacity index). */
  latest_year: number | null;
  latest_total_efficient_power_mw: number | null;
  latest_total_installed_capacity_gw: number | null;
  previous_year: number | null;
  previous_total_efficient_power_mw: number | null;
  /** Year-on-year new additions in the primary unit. */
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

export interface CredentialStatus {
  configured: boolean;
  client_id_suffix: string | null;
}

export interface CredentialPayload {
  client_id: string;
  client_secret: string;
}

export type SyncStatus = "queued" | "running" | "completed" | "failed";

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
  failed_steps?: number;
  /** Steps that returned no rows (future years, unsupported combos). Not failures. */
  empty_steps?: number;
}

export interface SyncRequest {
  years: number[];
  datasets: DatasetName[];
  sources: string[];
  capacity_types: CapacityType[];
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

export interface DataQuality {
  years: DataQualityYear[];
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
  installed_capacity_year_window: number;
  database: {
    datasets?: string[];
    years?: number[];
    regions?: string[];
    provinces?: string[];
    sources?: string[];
    capacity_types?: string[];
    categories?: string[];
    subcategories?: string[];
    types?: string[];
  };
}

export interface HealthStatus {
  status: string;
}
