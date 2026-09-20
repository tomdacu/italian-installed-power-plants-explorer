import { useQuery } from "@tanstack/react-query";
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
import { api } from "@/api/client";
import { SINGLE_SERIES_COLOR, formatGw, formatMw } from "@/lib/utils";
import { csvNumber, type CsvTable } from "@/lib/csv";
import type { AggregatePoint, GroupBy, RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { measureCsvKey } from "./CapacityOverTimeChart";
import { ChartEmptyState } from "./ChartEmptyState";

/**
 * CSV of the geography bars. The chart draws the top 15 to stay readable; the
 * file carries every area of the selection, which is what the numbers are for.
 */
export function capacityByGeographyCsv(
  records: AggregatePoint[],
  groupBy: string,
  isGw: boolean,
): CsvTable {
  const rawKey = isGw ? "installed_capacity_gw" : "efficient_power_mw";
  const valueKey = measureCsvKey(isGw);
  const total = records.reduce((sum, record) => sum + (record[rawKey] ?? 0), 0);
  return {
    columns: [
      { key: groupBy, label: groupBy },
      { key: valueKey, label: valueKey },
      { key: "share_percent", label: "share_percent" },
    ],
    rows: records.map((record) => {
      const value = record[rawKey];
      return {
        [groupBy]: record[groupBy as keyof AggregatePoint] ?? "",
        [valueKey]: csvNumber(value),
        share_percent:
          total > 0 && value !== null ? csvNumber((value / total) * 100) : null,
      };
    }),
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
  const isGw = filters.dataset === "installed_capacity";
  const valueKey = isGw ? "installed_capacity_gw" : "efficient_power_mw";
  const fmt = isGw ? formatGw : formatMw;
  const unit = isGw ? "GW" : "MW";
  const data = useQuery({
    // latest_only: stock of the latest year — summing stocks of several
    // years would count the same plants multiple times.
    queryKey: ["timeseries", groupBy, "latest", valueKey, filters],
    queryFn: () => api.timeseries(groupBy, filters, { latest_only: true }),
  });

  const records = (data.data ?? []).slice().sort(
    (a, b) => ((b[valueKey] as number | null) ?? 0) - ((a[valueKey] as number | null) ?? 0),
  );
  const top = records.slice(0, 15);

  return (
    <ChartCard
      title={title}
      description={`Latest-year stock (${unit}) aggregated by ${groupBy} — top 15`}
      filename={filename}
      csv={() => capacityByGeographyCsv(records, groupBy, isGw)}
    >
      {data.isLoading ? (
        <LoadingOverlay label="Loading geography" />
      ) : data.isError ? (
        <ErrorState message={(data.error as Error).message} />
      ) : top.length > 0 ? (
        <ResponsiveContainer width="100%" height={Math.max(220, top.length * 28)}>
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
              dataKey={groupBy}
              stroke="currentColor"
              className="text-ink-400"
              tick={{ fontSize: 10.5 }}
              width={150}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: number) => [`${fmt(value)} ${unit}`, isGw ? "Installed capacity" : "Efficient power"]}
              cursor={{ fill: "currentColor", className: "text-ink-200/40 dark:text-white/[0.04]" }}
            />
            <Bar dataKey={valueKey} name={isGw ? "Installed capacity GW" : "Efficient power MW"} radius={[0, 8, 8, 0]} maxBarSize={18}>
              {top.map((r, i) => (
                <Cell key={r[groupBy] ?? i} fill={SINGLE_SERIES_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
