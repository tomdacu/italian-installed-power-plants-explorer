import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colorFor, formatMw } from "@/lib/utils";
import { yearlySplitCsv } from "@/lib/chart-csv";
import { useYearlySplit } from "@/hooks/useTimeseries";
import type { RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { ChartEmptyState } from "./ChartEmptyState";

/** Stock installato per anno, impilato per fonte (o per tipo sul dataset nazionale). */
export function CapacityOverTimeChart({ filters }: { filters: RecordFilters }) {
  const series = useYearlySplit(filters);
  const fmt = series.data?.measure.format ?? formatMw;
  const unit = series.data?.measure.unit ?? "MW";

  return (
    <ChartCard
      title="Capacity over time"
      description={
        filters.dataset === "installed_capacity"
          ? "Installed stock (GW) by year, split by type"
          : `Installed stock (${unit}) by year, split by source`
      }
      filename="capacity-over-time"
      csv={() => (series.data ? yearlySplitCsv(series.data) : null)}
    >
      {series.isLoading ? (
        <LoadingOverlay label="Loading capacity trend" />
      ) : series.isError ? (
        <ErrorState message={(series.error as Error).message} />
      ) : series.data && series.data.data.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={series.data.data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <defs>
              {series.data.names.map((source, index) => (
                <linearGradient key={source} id={`grad-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorFor(source, index, filters.dataset ?? undefined)} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={colorFor(source, index, filters.dataset ?? undefined)} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" className="text-ink-200/60 dark:text-white/[0.06]" vertical={false} />
            <XAxis dataKey="year" stroke="currentColor" className="text-ink-400" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              stroke="currentColor"
              className="text-ink-400"
              tick={{ fontSize: 11 }}
              tickFormatter={(value) => `${fmt(value as number)} ${unit}`}
              width={88}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${fmt(value)} ${unit}`, undefined]}
              labelFormatter={(label) => `Year ${label}`}
              cursor={{ stroke: "currentColor", className: "text-ink-300", strokeDasharray: "4 4" }}
            />
            <Legend iconType="circle" iconSize={8} />
            {series.data.names.map((source, index) => (
              <Area
                key={source}
                type="monotone"
                dataKey={source}
                stackId="1"
                stroke={colorFor(source, index, filters.dataset ?? undefined)}
                strokeWidth={2}
                fill={`url(#grad-${index})`}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset ?? undefined} />}
    </ChartCard>
  );
}
