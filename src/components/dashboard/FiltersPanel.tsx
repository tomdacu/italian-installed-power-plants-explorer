import { Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, toOptions } from "@/components/ui/Select";
import { DATASET_LABELS } from "@/api/client";
import { useMetadata } from "@/hooks/useMetadata";
import type { CapacityType, DatasetName, RecordFilters } from "@/types";
import { cn } from "@/lib/utils";

export interface DashboardFilters extends RecordFilters {
  dataset: DatasetName;
  geoLevel: "national" | "region" | "province";
}

const DATASET_OPTIONS = (Object.keys(DATASET_LABELS) as DatasetName[]).map((d) => ({
  label: DATASET_LABELS[d],
  value: d,
}));

// Single index only: offering "All" would sum Lorda+Netta and double-count
// every MW in totals and charts.
const CAPACITY_OPTIONS = [
  { label: "Lorda (Gross)", value: "Lorda" },
  { label: "Netta (Net)", value: "Netta" },
];

const GEO_OPTIONS = [
  { label: "National", value: "national" },
  { label: "Region", value: "region" },
  { label: "Province", value: "province" },
];

export function FiltersPanel({
  filters,
  onChange,
  onReset,
  className,
}: {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onReset: () => void;
  className?: string;
}) {
  const meta = useMetadata();
  const db = meta.data?.database ?? {};
  const showRegionFilter = filters.geoLevel !== "national";
  const showProvinceFilter = filters.geoLevel === "province";

  // Keep the picker ranges strictly increasing regardless of API ordering.
  const years = (db.years ?? []).slice().sort((a, b) => a - b);
  const minYear = years.length ? years[0] : 2018;
  const maxYear = years.length ? years[years.length - 1] : new Date().getFullYear();

  const regionOptions = toOptions(db.regions ?? []);
  const provinceOptions = toOptions(db.provinces ?? []);
  const sourceOptions = toOptions(
    filters.dataset === "installed_capacity"
      ? (meta.data?.known_installed_capacity_types ?? db.types ?? [])
      : (db.sources ?? meta.data?.known_sources ?? []),
  );

  const yearFromOptions = Array.from({ length: maxYear - minYear + 1 }, (_, i) => ({
    label: String(minYear + i),
    value: String(minYear + i),
  }));
  const yearToOptions = yearFromOptions.slice().reverse();

  const set = (patch: Partial<DashboardFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className={cn("card p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <Filter className="h-3.5 w-3.5" />
          </span>
          <h2 className="font-display text-sm font-semibold text-ink-900 dark:text-white">Filters</h2>
          {meta.isLoading && <span className="text-xs text-ink-400">loading options…</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Select
          label="Dataset"
          value={filters.dataset}
          options={DATASET_OPTIONS}
          onChange={(e) =>
            set({
              dataset: e.target.value as DatasetName,
              source: "",
              category: "",
              subcategory: "",
              type: "",
            })
          }
        />
        <Select
          label="Geography level"
          value={filters.geoLevel}
          options={GEO_OPTIONS}
          onChange={(e) =>
            set({
              geoLevel: e.target.value as DashboardFilters["geoLevel"],
              region: "",
              province: "",
            })
          }
        />
        <Select
          label="Year from"
          value={String(filters.year_from ?? "")}
          placeholder="Any"
          options={yearFromOptions}
          onChange={(e) => set({ year_from: e.target.value ? Number(e.target.value) : null })}
        />
        <Select
          label="Year to"
          value={String(filters.year_to ?? "")}
          placeholder="Any"
          options={yearToOptions}
          onChange={(e) => set({ year_to: e.target.value ? Number(e.target.value) : null })}
        />
        {showRegionFilter && (
          <Select
            label="Region"
            value={filters.region}
            placeholder="All regions"
            options={regionOptions}
            disabled={!regionOptions.length}
            onChange={(e) => set({ region: e.target.value, province: "" })}
          />
        )}
        {showProvinceFilter && (
          <Select
            label="Province"
            value={filters.province}
            placeholder="All provinces"
            options={provinceOptions}
            disabled={!provinceOptions.length}
            onChange={(e) => set({ province: e.target.value })}
          />
        )}
        <Select
          label={filters.dataset === "installed_capacity" ? "Type" : "Source"}
          value={filters.dataset === "installed_capacity" ? (filters.type ?? "") : (filters.source ?? "")}
          placeholder="All"
          options={sourceOptions}
          disabled={!sourceOptions.length}
          onChange={(e) =>
            filters.dataset === "installed_capacity"
              ? set({ type: e.target.value, source: "" })
              : set({ source: e.target.value })
          }
        />
        <Select
          label="Capacity type"
          value={filters.capacity_type || "Lorda"}
          options={CAPACITY_OPTIONS}
          onChange={(e) => set({ capacity_type: e.target.value as CapacityType })}
        />
      </div>
    </div>
  );
}

export { DATASET_OPTIONS };
