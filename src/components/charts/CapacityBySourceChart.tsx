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
import { colorFor, formatGw, formatMw } from "@/lib/utils";
import { csvNumber, type CsvTable } from "@/lib/csv";
import type { AggregatePoint, GroupBy, RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { measureCsvKey } from "./CapacityOverTimeChart";
import { ChartEmptyState } from "./ChartEmptyState";

/** CSV of the by-source bars: latest-year stock of every series, not just the drawn ones. */
export function capacityBySplitCsv(
  records: AggregatePoint[],
  splitKey: string,
  isGw: boolean,
): CsvTable {
  const rawKey = isGw ? "installed_capacity_gw" : "efficient_power_mw";
  const valueKey = measureCsvKey(isGw);
  return {
    columns: [
      { key: splitKey, label: splitKey },
      { key: valueKey, label: valueKey },
    ],
    rows: records.map((record) => ({
      [splitKey]: record[splitKey as keyof AggregatePoint] ?? "",
      [valueKey]: csvNumber(record[rawKey]),
    })),
  };
}

export function CapacityBySourceChart({ filters }: { filters: RecordFilters }) {
  // installed_capacity rows carry `type` instead of `source`.
  const splitKey: Exclude<GroupBy, "year"> = filters.dataset === "installed_capacity" ? "type" : "source";
  const isGw = filters.dataset === "installed_capacity";
  const valueKey = isGw ? "installed_capacity_gw" : "efficient_power_mw";
  const fmt = isGw ? formatGw : formatMw;
  const unit = isGw ? "GW" : "MW";
  const data = useQuery({
    // latest_only: stock of the latest year — summing stocks of several
    // years would count the same plants multiple times.
    queryKey: ["timeseries", splitKey, "latest", valueKey, filters],
    queryFn: () => api.timeseries(splitKey, filters, { latest_only: true }),
  });

  const records = (data.data ?? []).slice().sort(
    (a, b) => ((b[valueKey] as number | null) ?? 0) - ((a[valueKey] as number | null) ?? 0),
  );
  const isInstalled = filters.dataset === "installed_capacity";

  return (
    <ChartCard
      title={isInstalled ? "Capacity by type" : "Capacity by source"}
      description={`Latest-year stock (${unit}) aggregated by ${splitKey}`}
      filename={isInstalled ? "capacity-by-type" : "capacity-by-source"}
      csv={() => capacityBySplitCsv(records, splitKey, isGw)}
    >
      {data.isLoading ? (
        <LoadingOverlay label="Loading sources" />
      ) : data.isError ? (
        <ErrorState message={(data.error as Error).message} />
      ) : records.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={records} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap="28%">
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
            <Bar dataKey={valueKey} name={isInstalled ? "Installed capacity GW" : "Efficient power MW"} radius={[0, 8, 8, 0]} maxBarSize={26}>
              {records.map((r, i) => (
                <Cell key={r[splitKey] ?? i} fill={colorFor(String(r[splitKey] ?? ""), i, filters.dataset)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset} />}
    </ChartCard>
  );
}
