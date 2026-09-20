import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Availability, DataQuality, MetadataOptions, RecordFilters } from "@/types";

export function useMetadata() {
  return useQuery<MetadataOptions>({
    queryKey: ["metadata"],
    queryFn: () => api.metadataOptions(),
    staleTime: 60_000,
  });
}

export function useAvailability() {
  return useQuery<Availability>({
    queryKey: ["availability"],
    queryFn: () => api.availability(),
    staleTime: 30_000,
  });
}

/**
 * Publication gaps for the rows the dashboard is showing: Terna leaves some
 * cells empty in its year files, which understates those year totals.
 */
export function useDataQuality(filters: RecordFilters) {
  return useQuery<DataQuality>({
    queryKey: ["data-quality", filters],
    queryFn: () => api.dataQuality(filters),
    staleTime: 30_000,
  });
}

export function useCredentialStatus() {
  return useQuery({
    queryKey: ["credentials", "status"],
    queryFn: () => api.credentialStatus(),
    staleTime: 30_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    staleTime: 15_000,
    retry: false,
    // While the backend is still booting, keep checking every few seconds;
    // once it is up, settle into a slow heartbeat.
    refetchInterval: (query) => (query.state.error ? 5_000 : 30_000),
  });
}
