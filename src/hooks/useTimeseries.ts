import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { measureFor, type SeriesRow, type YearlySplit } from "@/lib/chart-data";
import type { GroupBy, RecordFilters } from "@/types";

/** Serie aggregata: un solo posto per le richieste dei grafici. */
export function useTimeseries(
  groupBy: GroupBy,
  filters: RecordFilters,
  options: { latestOnly?: boolean } = {},
) {
  const measure = measureFor(filters);
  const latestOnly = options.latestOnly ?? false;
  return useQuery({
    // `latest_only` fa parte della chiave: la stessa combinazione disegnata su
    // un solo anno e su tutti gli anni sono due risposte diverse.
    queryKey: ["timeseries", groupBy, latestOnly ? "latest" : "all", measure.valueKey, filters],
    queryFn: () => api.timeseries(groupBy, filters, { latest_only: latestOnly }),
  });
}

/**
 * Stock per anno diviso per fonte — o per tipo quando il dataset è quello
 * nazionale, che porta `type` invece di `source`. Una sola richiesta composta
 * `year,<split>` restituisce tutto il riparto.
 */
export function useYearlySplit(filters: RecordFilters) {
  const splitKey = filters.dataset === "installed_capacity" ? "type" : "source";
  const groupBy = `year,${splitKey}` as "year,source" | "year,type";
  const measure = measureFor(filters);
  const query = useTimeseries(groupBy, filters);

  return {
    ...query,
    data: query.data
      ? ((): YearlySplit => {
          const byYear = new Map<number, SeriesRow>();
          const names = new Set<string>();
          for (const row of query.data) {
            const year = row.year ?? 0;
            const name = (row[splitKey] as string | null) ?? "Unknown";
            names.add(name);
            const entry = byYear.get(year) ?? { year };
            entry[name] =
              ((entry[name] as number | undefined) ?? 0) + ((row[measure.valueKey] as number | null) ?? 0);
            byYear.set(year, entry);
          }
          const years = [...byYear.keys()].sort((a, b) => a - b);
          return {
            splitKey,
            measure,
            data: years.map((year) => byYear.get(year) as SeriesRow),
            names: [...names].sort(),
          };
        })()
      : undefined,
  };
}
