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
import type { RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { colorFor } from "@/lib/utils";
import { useYearlySplit } from "./CapacityOverTimeChart";
import { ChartEmptyState } from "./ChartEmptyState";

/**
 * Year-on-year additions per source: the annual change of installed stock.
 * Answers "how much did each source grow?" — the closest proxy for new
 * installations the yearly stock data allows (net of decommissioning).
 */
export function GrowthChart({ filters }: { filters: RecordFilters }) {
  const series = useYearlySplit(filters);
  const { data, isLoading, isError, error } = series;

  const growth = (() => {
    if (!data || data.data.length < 2) return null;
    const rows = data.data;
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const entry: Record<string, number> = { year: cur.year as number };
      for (const name of data.names) {
        entry[name] = ((cur[name] as number | undefined) ?? 0) - ((prev[name] as number | undefined) ?? 0);
      }
      out.push(entry);
    }
    return { rows: out, names: data.names, measure: data.measure };
  })();

  const fmt = growth?.measure.format;
  const unit = growth?.measure.unit ?? "MW";

  return (
    <ChartCard
      title={filters.dataset === "installed_capacity" ? "Annual additions by type" : "Annual additions by source"}
      description="Year-on-year change of installed stock — new capacity net of decommissioning"
      filename="annual-additions"
      csvFilters={filters}
    >
      {isLoading ? (
        <LoadingOverlay label="Loading growth" />
      ) : isError ? (
        <ErrorState message={(error as Error).message} />
      ) : growth && growth.rows.length > 0 && fmt ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={growth.rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="24%">
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
              labelFormatter={(l) => `Additions ${l}`}
              cursor={{ fill: "currentColor", className: "text-ink-200/40 dark:text-white/[0.04]" }}
            />
            <Legend iconType="circle" iconSize={8} />
            {growth.names.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="growth" fill={colorFor(s, i, filters.dataset)} radius={[4, 4, 0, 0]} maxBarSize={42} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : data && data.data.length > 0 ? (
        <div className="grid h-[200px] place-items-center text-center text-sm text-ink-500 dark:text-ink-400">
          Select at least two years to see annual additions
        </div>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
