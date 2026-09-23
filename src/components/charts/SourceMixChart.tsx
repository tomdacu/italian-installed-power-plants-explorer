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
import { sourceMixCsv } from "@/lib/chart-csv";
import { useYearlySplit } from "@/hooks/useTimeseries";
import type { RecordFilters } from "@/types";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/EmptyState";
import { ChartCard } from "./ChartCard";
import { ChartEmptyState } from "./ChartEmptyState";
import { axisProps, axisTick, gridHorizontal, legendProps, tooltipCursor } from "./chart-theme";

/** Barre impilate: stessa serie del grafico nel tempo, qui per leggere le quote. */
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
      csv={() => (data ? sourceMixCsv(data) : null)}
    >
      {isLoading ? (
        <LoadingOverlay label="Loading mix" />
      ) : isError ? (
        <ErrorState message={(error as Error).message} />
      ) : data && data.data.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="24%">
            <CartesianGrid {...gridHorizontal} />
            <XAxis {...axisProps} tick={axisTick} dataKey="year" />
            <YAxis
              {...axisProps}
              tick={axisTick}
              tickFormatter={(value) => `${fmt(value as number)} ${unit}`}
              width={88}
            />
            <Tooltip
              formatter={(value: number) => [`${fmt(value)} ${unit}`, undefined]}
              labelFormatter={(label) => `Year ${label}`}
              cursor={tooltipCursor}
            />
            <Legend {...legendProps} />
            {data.names.map((source, index) => (
              <Bar key={source} dataKey={source} stackId="mix" fill={colorFor(source, index, filters.dataset ?? undefined)} radius={[4, 4, 0, 0]} maxBarSize={42} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <ChartEmptyState dataset={filters.dataset ?? undefined} />}
    </ChartCard>
  );
}
