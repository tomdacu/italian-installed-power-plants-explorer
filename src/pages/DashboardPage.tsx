import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Globe2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { FiltersPanel, type DashboardFilters } from "@/components/dashboard/FiltersPanel";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { DataTable } from "@/components/dashboard/DataTable";
import { CapacityOverTimeChart } from "@/components/charts/CapacityOverTimeChart";
import { CapacityBySourceChart } from "@/components/charts/CapacityBySourceChart";
import { CapacityByRegionChart } from "@/components/charts/CapacityByRegionChart";
import { SourceMixChart } from "@/components/charts/SourceMixChart";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { MethodologyNote } from "@/components/dashboard/MethodologyNote";
import { Button } from "@/components/ui/Button";
import { api } from "@/api/client";
import { downloadString } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import type { CapacityType, DatasetName, RecordFilters } from "@/types";

const DEFAULT_FILTERS: DashboardFilters = {
  dataset: "renewable_source_capacity",
  geoLevel: "region",
  year_from: null,
  year_to: null,
  region: "",
  province: "",
  source: "",
  // Single index by default: summing Lorda+Netta would double-count every MW.
  capacity_type: "Lorda",
};

export function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const toast = useToast();

  const apiFilters: RecordFilters = useMemo(() => {
    const yearFrom = filters.year_from || null;
    const yearTo = filters.year_to || null;
    // Keep the range sane even if the pickers end up inverted.
    const [safeFrom, safeTo] =
      yearFrom && yearTo && yearFrom > yearTo ? [yearTo, yearFrom] : [yearFrom, yearTo];
    const isInstalled = filters.dataset === "installed_capacity";
    return {
      dataset: filters.dataset,
      year_from: safeFrom,
      year_to: safeTo,
      region: filters.geoLevel === "national" ? "" : filters.region,
      province: filters.geoLevel === "province" ? filters.province : "",
      source: isInstalled ? "" : filters.source,
      // installed_capacity rows have no capacity_type in the database — sending
      // one would filter everything out. Everywhere else exactly one index is
      // always selected (default Lorda) so totals never double-count.
      capacity_type: !isInstalled && filters.capacity_type ? (filters.capacity_type as CapacityType) : "",
      // For the installed_capacity dataset the "Source" picker selects a
      // national capacity *type* — it is stored in `filters.type` (see
      // FiltersPanel) and must be forwarded as such.
      type: isInstalled ? (filters.type ?? "") : "",
    };
  }, [filters]);

  const summary = useQuery({
    queryKey: ["summary", apiFilters],
    queryFn: () => api.summary(apiFilters),
  });

  const handleExportAll = async () => {
    try {
      const text = await api.exportCsv(apiFilters);
      downloadString(text, "italian-installed-capacity.csv", "text/csv;charset=utf-8");
      toast.success("CSV exported", "italian-installed-capacity.csv is in your downloads");
    } catch (e) {
      toast.error("Export failed", (e as Error).message);
    }
  };

  const isNational = filters.geoLevel === "national";

  return (
    <div>
      <Topbar
        title="Dashboard"
        subtitle="Explore installed generation capacity across Italy"
        actions={
          <Button variant="outline" size="sm" className="h-9" onClick={handleExportAll}>
            <Download className="h-3.5 w-3.5" /> Export all CSV
          </Button>
        }
      />
      <div className="mx-auto max-w-[1400px] animate-fade-in space-y-5 p-6 pt-4">
        <FiltersPanel
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters({ ...DEFAULT_FILTERS, dataset: filters.dataset as DatasetName })}
        />

        <KpiCards summary={summary.data} loading={summary.isLoading} isGw={apiFilters.dataset === "installed_capacity"} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <CapacityOverTimeChart filters={apiFilters} />
          <SourceMixChart filters={apiFilters} />
          <GrowthChart filters={apiFilters} />
          <CapacityBySourceChart filters={apiFilters} />
          {!isNational ? (
            filters.geoLevel === "region" ? (
              <CapacityByRegionChart filters={apiFilters} groupBy="region" />
            ) : (
              <CapacityByRegionChart
                filters={apiFilters}
                groupBy="province"
                title="Capacity by province"
                filename="capacity-by-province"
              />
            )
          ) : (
            <div className="card grid place-items-center p-10 text-center">
              <div className="flex max-w-xs flex-col items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  <Globe2 className="h-5 w-5" />
                </span>
                <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                  You are viewing <strong className="font-semibold text-ink-800 dark:text-ink-100">national</strong> data.
                  Switch the geography level to <strong className="font-semibold text-ink-800 dark:text-ink-100">Region</strong> or{" "}
                  <strong className="font-semibold text-ink-800 dark:text-ink-100">Province</strong> to compare areas.
                </p>
              </div>
            </div>
          )}
        </div>

        <DataTable filters={apiFilters} />
        <MethodologyNote />
      </div>
    </div>
  );
}
