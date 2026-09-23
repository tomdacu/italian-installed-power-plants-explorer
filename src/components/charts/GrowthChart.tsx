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
import { colorFor, formatMw } from "@/lib/utils";
import { additionsCsv } from "@/lib/chart-csv";
import { yearlyAdditions } from "@/lib/chart-data";
import { useYearlySplit } from "@/hooks/useTimeseries";
import type { RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { ChartEmptyState } from "./ChartEmptyState";

/**
 * Variazione annua dello stock per fonte: la differenza fra anni consecutivi.
 * È la migliore approssimazione delle nuove installazioni che il dato annuale
 * consenta (al netto delle dismissioni). Gli anni mancanti si saltano.
 */
export function GrowthChart({ filters }: { filters: RecordFilters }) {
  const series = useYearlySplit(filters);
  const { data, isLoading, isError, error } = series;
  const growth = data ? yearlyAdditions(data) : null;
  const fmt = growth?.measure.format ?? formatMw;
  const unit = growth?.measure.unit ?? "MW";

  return (
    <ChartCard
      title={filters.dataset === "installed_capacity" ? "Annual additions by type" : "Annual additions by source"}
      description="Year-on-year change of installed stock — new capacity net of decommissioning"
      filename="annual-additions"
      csv={() => (growth && data ? additionsCsv(growth, data.splitKey) : null)}
    >
      {isLoading ? (
        <LoadingOverlay label="Loading growth" />
      ) : isError ? (
        <ErrorState message={(error as Error).message} />
      ) : growth && growth.rows.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={growth.rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="24%">
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" className="text-ink-200/60 dark:text-white/[0.06]" vertical={false} />
            <XAxis dataKey="year" stroke="currentColor" className="text-ink-500 dark:text-ink-400" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              stroke="currentColor"
              className="text-ink-500 dark:text-ink-400"
              tick={{ fontSize: 11 }}
              tickFormatter={(value) => `${fmt(value as number)} ${unit}`}
              width={88}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${fmt(value)} ${unit}`, undefined]}
              labelFormatter={(label) => `Additions ${label}`}
              cursor={{ fill: "currentColor", className: "text-ink-200/40 dark:text-white/[0.04]" }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              // Lo swatch resta del colore della serie, il testo no: il giallo
              // del fotovoltaico su bianco sta a 2.15:1.
              formatter={(value) => <span className="text-ink-500 dark:text-ink-400">{value}</span>}
            />
            {growth.names.map((source, index) => (
              <Bar key={source} dataKey={source} stackId="growth" fill={colorFor(source, index, filters.dataset ?? undefined)} radius={[4, 4, 0, 0]} maxBarSize={42} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : data && data.data.length > 0 ? (
        <div className="grid h-[200px] place-items-center text-center text-sm text-ink-500 dark:text-ink-400">
          Select at least two consecutive years to see annual additions
        </div>
      ) : <ChartEmptyState dataset={filters.dataset ?? undefined} />}
    </ChartCard>
  );
}
