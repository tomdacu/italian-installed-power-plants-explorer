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
import type { RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { useYearlySplit } from "./CapacityOverTimeChart";
import { ChartEmptyState } from "./ChartEmptyState";

/** Stacked bars of the same yearly breakdown — shares the query (and cache
 * entry) with the capacity-over-time chart, so no extra request is made. */
export function SourceMixChart({ filters }: { filters: RecordFilters }) {
  const series = useYearlySplit(filters);
  const { data, isLoading, isError, error } = series;
  const fmt = data?.measure.format ?? formatMw;
  const unit = data?.measure.unit ?? "MW";

  return (
    <ChartCard
      title="Source mix over time"
      description={
        filters.dataset === "installed_capacity"
          ? `Stacked installed stock (${unit}) showing the contribution of each type`
          : `Stacked installed stock (${unit}) showing the contribution of each source`
      }
      filename="source-mix"
      csvFilters={filters}
    >
      {isLoading ? (
        <LoadingOverlay label="Loading mix" />
      ) : isError ? (
        <ErrorState message={(error as Error).message} />
      ) : data && data.data.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="24%">
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" className="text-ink-200/60 dark:text-white/[0.06]" vertical={false} />
            <XAxis dataKey="year" stroke="currentColor" className="text-ink-400" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              stroke="currentColor"
              className="text-ink-400"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${fmt(v as number)} ${unit}`}
              width={88}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${fmt(value)} ${unit}`, undefined]}
              labelFormatter={(l) => `Year ${l}`}
              cursor={{ fill: "currentColor", className: "text-ink-200/40 dark:text-white/[0.04]" }}
            />
            <Legend iconType="circle" iconSize={8} />
            {data.names.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="mix" fill={colorFor(s, i, filters.dataset)} radius={[4, 4, 0, 0]} maxBarSize={42} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
