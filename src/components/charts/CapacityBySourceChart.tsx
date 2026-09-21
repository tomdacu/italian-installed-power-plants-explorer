import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colorFor } from "@/lib/utils";
import { capacityBySplitCsv } from "@/lib/chart-csv";
import { measureFor } from "@/lib/chart-data";
import { useTimeseries } from "@/hooks/useTimeseries";
import type { GroupBy, RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { ChartEmptyState } from "./ChartEmptyState";

/** Stock dell'ultimo anno per fonte (o per tipo sul dataset nazionale). */
export function CapacityBySourceChart({ filters }: { filters: RecordFilters }) {
  const { isGw, valueKey, unit, format: fmt } = measureFor(filters);
  // Le righe del dataset nazionale portano `type` al posto di `source`.
  const splitKey: Exclude<GroupBy, "year"> = isGw ? "type" : "source";
  const isInstalled = isGw;

  // latest_only: lo stock di un solo anno — sommare più anni conterebbe più
  // volte gli stessi impianti.
  const query = useTimeseries(splitKey, filters, { latestOnly: true });
  const records = (query.data ?? [])
    .slice()
    .sort((a, b) => ((b[valueKey] as number | null) ?? 0) - ((a[valueKey] as number | null) ?? 0));

  return (
    <ChartCard
      title={isInstalled ? "Capacity by type" : "Capacity by source"}
      description={`Latest-year stock (${unit}) aggregated by ${splitKey}`}
      filename={isInstalled ? "capacity-by-type" : "capacity-by-source"}
      csv={() => capacityBySplitCsv(records, splitKey, isGw)}
    >
      {query.isLoading ? (
        <LoadingOverlay label="Loading sources" />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} />
      ) : records.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={records} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" className="text-ink-200/60 dark:text-white/[0.06]" horizontal={false} />
            <XAxis
              type="number"
              stroke="currentColor"
              className="text-ink-400"
              tickFormatter={(value) => `${fmt(value as number)} ${unit}`}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey={splitKey}
              stroke="currentColor"
              className="text-ink-400"
              tick={{ fontSize: 11 }}
              width={120}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${fmt(value)} ${unit}`, isInstalled ? "Installed capacity" : "Efficient power"]}
              cursor={{ fill: "currentColor", className: "text-ink-200/40 dark:text-white/[0.04]" }}
            />
            <Bar dataKey={valueKey} name={isInstalled ? `Installed capacity ${unit}` : `Efficient power ${unit}`} radius={[0, 8, 8, 0]} maxBarSize={26}>
              {records.map((record, index) => (
                <Cell key={record[splitKey] ?? index} fill={colorFor(String(record[splitKey] ?? ""), index, filters.dataset ?? undefined)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset ?? undefined} />}
    </ChartCard>
  );
}
