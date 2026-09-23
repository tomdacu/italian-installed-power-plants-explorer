import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Availability, DataQuality, MetadataOptions, RecordFilters } from "@/types";
import { queryKeys } from "@/lib/query-keys";

export function useMetadata() {
  return useQuery<MetadataOptions>({
    queryKey: queryKeys.metadata(),
    queryFn: () => api.metadataOptions(),
    staleTime: 60_000,
  });
}

export function useAvailability() {
  return useQuery<Availability>({
    queryKey: queryKeys.availability(),
    queryFn: () => api.availability(),
    staleTime: 30_000,
    // Un errore di rete all'avvio non deve congelare la UI per sempre: finché
    // la query è in errore si ritenta da sola, e al primo successo si smette.
    refetchInterval: (query) => (query.state.status === "error" ? 15_000 : false),
  });
}

/**
 * Publication gaps for the rows the dashboard is showing: Terna leaves some
 * cells empty in its year files, which understates those year totals.
 */
export function useDataQuality(filters: RecordFilters) {
  return useQuery<DataQuality>({
    queryKey: queryKeys.dataQuality(filters),
    queryFn: () => api.dataQuality(filters),
    staleTime: 30_000,
  });
}

export function useCredentialStatus() {
  return useQuery({
    queryKey: queryKeys.credentialStatus(),
    queryFn: () => api.credentialStatus(),
    staleTime: 30_000,
    // Il banner offline deve tornare verde da solo: se la query è in errore
    // (servizio locale non ancora pronto, o appena riavviato) si ritenta ogni
    // 15 s finché non riesce, poi si torna al ritmo normale.
    refetchInterval: (query) => (query.state.status === "error" ? 15_000 : false),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => api.health(),
    staleTime: 15_000,
    retry: false,
    // While the backend is still booting, keep checking every few seconds;
    // once it is up, settle into a slow heartbeat.
    refetchInterval: (query) => (query.state.error ? 5_000 : 30_000),
  });
}
