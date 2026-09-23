/**
 * Chiavi di react-query: un solo posto per ogni identità di cache.
 *
 * Erano letterali sparsi in dieci file: due siti che dovevano parlare della
 * stessa query potevano divergere di un carattere senza che nulla lo
 * segnalasse. Ogni fabbrica produce **lo stesso array** del letterale che
 * sostituisce — la chiave è l'identità persistente della cache, e cambiarla
 * significa un refetch silenzioso.
 *
 * Le fabbriche `all*` sono i prefissi: react-query invalida per prefisso, e
 * `["summary"]` copre ogni combinazione di filtri.
 */
import type { GroupBy, RecordFilters } from "@/types";

/** Ordine di ordinamento della tabella record (`DataTable`). */
export type RecordOrder = "asc" | "desc";

export const queryKeys = {
  /** `["credentials"]` — prefisso: copre anche `credentialStatus`. */
  credentials: () => ["credentials"] as const,

  /** `["credentials", "status"]` */
  credentialStatus: () => ["credentials", "status"] as const,

  /** `["metadata"]` */
  metadata: () => ["metadata"] as const,

  /** `["availability"]` */
  availability: () => ["availability"] as const,

  /** `["health"]` */
  health: () => ["health"] as const,

  /** `["data-quality", filters]` */
  dataQuality: (filters: RecordFilters) => ["data-quality", filters] as const,

  /** `["data-quality"]` — prefisso. */
  allDataQuality: () => ["data-quality"] as const,

  /** `["summary", filters]` */
  summary: (filters: RecordFilters) => ["summary", filters] as const,

  /** `["summary"]` — prefisso. */
  allSummaries: () => ["summary"] as const,

  /** `["records", filters, search, sortKey, order, page]` */
  records: (
    filters: RecordFilters,
    search: string,
    sortKey: string,
    order: RecordOrder,
    page: number,
  ) => ["records", filters, search, sortKey, order, page] as const,

  /** `["records"]` — prefisso. */
  allRecords: () => ["records"] as const,

  /**
   * `["timeseries", groupBy, latestOnly ? "latest" : "all", measureKey, filters]`
   *
   * `latest_only` fa parte della chiave: la stessa combinazione disegnata su un
   * solo anno e su tutti gli anni sono due risposte diverse.
   */
  timeseries: (
    groupBy: GroupBy,
    latestOnly: boolean,
    measureKey: string,
    filters: RecordFilters,
  ) => ["timeseries", groupBy, latestOnly ? "latest" : "all", measureKey, filters] as const,

  /** `["timeseries"]` — prefisso. */
  allTimeseries: () => ["timeseries"] as const,

  /** `["sync", "latest"]` */
  syncLatest: () => ["sync", "latest"] as const,

  /** `["sync", "job", jobId]` — `jobId` è `null` finché non c'è un job noto. */
  syncJob: (jobId: string | null) => ["sync", "job", jobId] as const,
};

/**
 * Query da rileggere dopo un sync concluso o cancellato: i passi già completati
 * hanno scritto nel database, e la dashboard mostrerebbe dati vecchi.
 */
export const INVALIDATE_AFTER_SYNC = [
  queryKeys.metadata(),
  queryKeys.availability(),
  queryKeys.allSummaries(),
  queryKeys.allRecords(),
  queryKeys.allTimeseries(),
  queryKeys.allDataQuality(),
] as const;
