/**
 * Tipi dell'interfaccia.
 *
 * Quelli che il server e la SPA condividono vivono in `shared/types.ts` e sono
 * riesportati qui: prima erano ricopiati a mano in questo file e le due copie
 * divergevano (`RecordFilters.dataset` era `""` da una parte e `null` dall'altra,
 * `SyncJobStatus` aveva campi opzionali solo qui). Restano locali solo i tipi
 * che riguardano esclusivamente la SPA.
 */
import type { DatasetName } from "../../shared/types";

export type {
  AggregatePoint,
  Availability,
  AvailabilityDataset,
  AvailabilityYear,
  CapacityRecord,
  CapacityType,
  CredentialStatus,
  DataQualityYear,
  DatasetName,
  GroupBy,
  HealthStatus,
  MetadataOptions,
  RecordFilters,
  Summary,
  SyncJobStatus,
  SyncJobResponse,
  SyncRequestPayload,
  SyncStatus,
} from "../../shared/types";

/** Corpo delle credenziali inviato a `POST /settings/credentials`. */
export interface CredentialPayload {
  client_id: string;
  client_secret: string;
}

/** Risposta di `GET /metadata/data-quality`. */
export interface DataQuality {
  years: { year: number; missing_values: number }[];
}

/** Opzioni di `GET /analytics/timeseries`. */
export interface TimeseriesOptions {
  latest_only?: boolean;
}

/** Richiesta di sync come la manda la SPA (il server accetta anche i soli anni). */
export interface SyncRequest {
  years: number[];
  datasets: DatasetName[];
}
