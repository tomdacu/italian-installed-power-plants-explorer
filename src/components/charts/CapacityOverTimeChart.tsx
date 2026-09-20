import { useQuery } from "@tanstack/react-query";
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
import { api } from "@/api/client";
import { colorFor, formatGw, formatMw } from "@/lib/utils";
import { csvNumber, type CsvTable } from "@/lib/csv";
import type { RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { ChartEmptyState } from "./ChartEmptyState";

type SeriesRow = Record<string, number | string>;

/** Measure used by a dataset: national installed capacity rows carry GW in
 * `installed_capacity_gw`, everything else carries MW in `efficient_power_mw`. */
export function measureFor(filters: RecordFilters) {
  const isGw = filters.dataset === "installed_capacity";
  return {
    isGw,
    valueKey: (isGw ? "installed_capacity_gw" : "efficient_power_mw") as
      | "installed_capacity_gw"
      | "efficient_power_mw",
    unit: isGw ? "GW" : "MW",
    format: isGw ? formatGw : formatMw,
  };
}

/**
 * Stacked area of installed stock per year, split by source — or by type when
 * the installed_capacity dataset is selected (its rows carry `type`, not
 * `source`). One compound `year,source` request returns the full breakdown.
 */
export function useYearlySplit(filters: RecordFilters) {
  const splitKey = filters.dataset === "installed_capacity" ? "type" : "source";
  const groupBy = `year,${splitKey}` as "year,source" | "year,type";
  const measure = measureFor(filters);
  return useQuery({
    queryKey: ["timeseries", groupBy, measure.valueKey, filters],
    queryFn: () => api.timeseries(groupBy, filters),
    select: (data) => {
      const byYear = new Map<number, SeriesRow>();
      const names = new Set<string>();
      for (const row of data) {
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
        data: years.map((y) => byYear.get(y) as SeriesRow),
        names: [...names],
      };
    },
  });
}

/** Shape returned by `useYearlySplit`, shared by every chart that exports it. */
export interface YearlySplit {
  splitKey: string;
  measure: { isGw: boolean; valueKey: string; unit: string };
  data: SeriesRow[];
  names: string[];
}

export interface YearlySplitCell {
  year: number;
  name: string;
  value: number;
}

/** One cell per year and series — the same numbers the stack is built from. */
export function yearlySplitCells(split: YearlySplit): YearlySplitCell[] {
  const cells: YearlySplitCell[] = [];
  for (const entry of split.data) {
    for (const name of split.names) {
      const value = entry[name];
      if (typeof value !== "number") continue;
      cells.push({ year: Number(entry.year), name, value });
    }
  }
  return cells;
}

export function measureCsvKey(isGw: boolean): string {
  return isGw ? "installed_capacity_gw" : "installed_capacity_mw";
}

/** CSV of the capacity-over-time chart: year, series and installed stock. */
export function yearlySplitCsv(split: YearlySplit): CsvTable {
  const valueKey = measureCsvKey(split.measure.isGw);
  return {
    columns: [
      { key: "year", label: "year" },
      { key: split.splitKey, label: split.splitKey },
      { key: valueKey, label: valueKey },
    ],
    rows: yearlySplitCells(split).map((cell) => ({
      year: cell.year,
      [split.splitKey]: cell.name,
      [valueKey]: csvNumber(cell.value),
    })),
  };
}

export function CapacityOverTimeChart({ filters }: { filters: RecordFilters }) {
  const series = useYearlySplit(filters);
  const fmt = series.data?.measure.format ?? formatMw;
  const unit = series.data?.measure.unit ?? "MW";

  return (
    <ChartCard
      title="Capacity over time"
      description={
        filters.dataset === "installed_capacity"
          ? `Installed stock (GW) by year, split by type`
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
              {series.data.names.map((s, i) => (
                <linearGradient key={s} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorFor(s, i, filters.dataset)} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={colorFor(s, i, filters.dataset)} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
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
              cursor={{ stroke: "currentColor", className: "text-ink-300", strokeDasharray: "4 4" }}
            />
            <Legend iconType="circle" iconSize={8} />
            {series.data.names.map((s, i) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stackId="1"
                stroke={colorFor(s, i, filters.dataset)}
                strokeWidth={2}
                fill={`url(#grad-${i})`}
                activeDot={{ r: 4, strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
