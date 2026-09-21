import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colorFor } from "@/lib/utils";
import { capacityByAreaSourceCsv } from "@/lib/chart-csv";
import { areaSeries, measureFor, type AreaRow } from "@/lib/chart-data";
import { useTimeseries } from "@/hooks/useTimeseries";
import type { GroupBy, RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { ChartEmptyState } from "./ChartEmptyState";

/**
 * Stock dell'ultimo anno per area, con la barra divisa per fonte: si vede a
 * colpo d'occhio da cosa è fatta la capacità di ogni regione, e in che misura.
 */
export function CapacityByRegionChart({
  filters,
  groupBy = "region",
  title = "Capacity by region",
  filename = "capacity-by-region",
}: {
  filters: RecordFilters;
  groupBy?: Extract<GroupBy, "region" | "province">;
  title?: string;
  filename?: string;
}) {
  const { isGw, valueKey, unit, format: fmt } = measureFor(filters);
  // Le righe del dataset nazionale portano `type` al posto di `source`.
  const splitKey = isGw ? "type" : "source";

  // latest_only: stock di un solo anno. Una richiesta composta restituisce
  // tutto il riparto, quindi la suddivisione non costa chiamate in più.
  const query = useTimeseries(`${groupBy},${splitKey}` as GroupBy, filters, { latestOnly: true });
  const series = areaSeries(query.data ?? [], groupBy, splitKey, valueKey);
  const top = series.rows.slice(0, 15);

  return (
    <ChartCard
      title={title}
      description={`Latest-year stock (${unit}) per ${groupBy}, split by ${splitKey} — top 15 areas`}
      filename={filename}
      csv={() => capacityByAreaSourceCsv(series, groupBy, splitKey, isGw)}
    >
      {query.isLoading ? (
        <LoadingOverlay label="Loading geography" />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} />
      ) : top.length > 0 ? (
        <ResponsiveContainer width="100%" height={Math.max(240, top.length * 30)}>
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap="24%">
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
              dataKey="area"
              stroke="currentColor"
              className="text-ink-400"
              tick={{ fontSize: 10.5 }}
              width={150}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number, name: string) => [`${fmt(value)} ${unit}`, name]}
              labelFormatter={(label, payload) => {
                const total = (payload?.[0]?.payload as AreaRow | undefined)?.total;
                return total ? `${label} — ${fmt(total)} ${unit} total` : String(label);
              }}
              cursor={{ fill: "currentColor", className: "text-ink-200/40 dark:text-white/[0.04]" }}
            />
            <Legend iconType="circle" iconSize={8} />
            {series.names.map((source, index) => (
              <Bar key={source} dataKey={source} stackId="area" fill={colorFor(source, index, filters.dataset)} maxBarSize={26} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
