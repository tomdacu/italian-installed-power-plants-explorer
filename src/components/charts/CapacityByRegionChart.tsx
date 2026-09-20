import { useQuery } from "@tanstack/react-query";
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
import { api } from "@/api/client";
import { colorFor, formatGw, formatMw } from "@/lib/utils";
import { csvNumber, type CsvTable } from "@/lib/csv";
import type { AggregatePoint, GroupBy, RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { measureCsvKey } from "./CapacityOverTimeChart";
import { ChartEmptyState } from "./ChartEmptyState";

/** Una riga della tabella: un'area con una colonna per fonte. */
export interface AreaRow {
  area: string;
  total: number;
  [series: string]: number | string;
}

export interface AreaSeries {
  rows: AreaRow[];
  /** Fonti presenti, dalla più grande alla più piccola. */
  names: string[];
}

/** Raggruppa le righe (area, fonte) in una riga per area, con i totali. */
export function areaSeries(
  records: AggregatePoint[],
  areaKey: string,
  splitKey: string,
  valueKey: "efficient_power_mw" | "installed_capacity_gw",
): AreaSeries {
  const byArea = new Map<string, AreaRow>();
  const totals = new Map<string, number>();

  for (const record of records) {
    const area = (record[areaKey as keyof AggregatePoint] as string | null) ?? "Unknown";
    const series = (record[splitKey as keyof AggregatePoint] as string | null) ?? "Unknown";
    const value = record[valueKey] ?? 0;
    const row = byArea.get(area) ?? { area, total: 0 };
    row[series] = ((row[series] as number | undefined) ?? 0) + value;
    row.total += value;
    byArea.set(area, row);
    totals.set(series, (totals.get(series) ?? 0) + value);
  }

  return {
    rows: [...byArea.values()].sort((a, b) => b.total - a.total),
    names: [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
  };
}

/**
 * CSV of the area bars: one row per area and source, with the source's MW and
 * its share of that area — the same breakdown the bars are split into. Every
 * area of the selection is written, not only the ones drawn.
 */
export function capacityByAreaSourceCsv(
  series: AreaSeries,
  areaKey: string,
  splitKey: string,
  isGw: boolean,
): CsvTable {
  const valueKey = measureCsvKey(isGw);
  const rows: Record<string, unknown>[] = [];
  for (const row of series.rows) {
    for (const name of series.names) {
      const value = row[name];
      if (typeof value !== "number") continue;
      rows.push({
        [areaKey]: row.area,
        [splitKey]: name,
        [valueKey]: csvNumber(value),
        share_in_area_percent: row.total > 0 ? csvNumber((value / row.total) * 100) : null,
      });
    }
  }
  return {
    columns: [
      { key: areaKey, label: areaKey },
      { key: splitKey, label: splitKey },
      { key: valueKey, label: valueKey },
      { key: "share_in_area_percent", label: "share_in_area_percent" },
    ],
    rows,
  };
}

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
  // installed_capacity rows carry `type` instead of `source`.
  const splitKey = filters.dataset === "installed_capacity" ? "type" : "source";
  const splitGroupBy = `${groupBy},${splitKey}`;
  const isGw = filters.dataset === "installed_capacity";
  const valueKey = isGw ? "installed_capacity_gw" : "efficient_power_mw";
  const fmt = isGw ? formatGw : formatMw;
  const unit = isGw ? "GW" : "MW";

  const data = useQuery({
    // latest_only: stock of the latest year — summing stocks of several years
    // would count the same plants multiple times. One compound request returns
    // the full breakdown, so the split costs no extra round trips.
    queryKey: ["timeseries", splitGroupBy, "latest", valueKey, filters],
    queryFn: () => api.timeseries(splitGroupBy as GroupBy, filters, { latest_only: true }),
  });

  const series = areaSeries(data.data ?? [], groupBy, splitKey, valueKey);
  const top = series.rows.slice(0, 15);

  return (
    <ChartCard
      title={title}
      description={`Latest-year stock (${unit}) per ${groupBy}, split by ${splitKey} — top 15 areas`}
      filename={filename}
      csv={() => capacityByAreaSourceCsv(series, groupBy, splitKey, isGw)}
    >
      {data.isLoading ? (
        <LoadingOverlay label="Loading geography" />
      ) : data.isError ? (
        <ErrorState message={(data.error as Error).message} />
      ) : top.length > 0 ? (
        <ResponsiveContainer width="100%" height={Math.max(240, top.length * 30)}>
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap="24%">
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" className="text-ink-200/60 dark:text-white/[0.06]" horizontal={false} />
            <XAxis
              type="number"
              stroke="currentColor"
              className="text-ink-400"
              tickFormatter={(v) => `${fmt(v as number)} ${unit}`}
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
            {series.names.map((name, index) => (
              <Bar
                key={name}
                dataKey={name}
                stackId="area"
                fill={colorFor(name, index, filters.dataset)}
                maxBarSize={26}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
