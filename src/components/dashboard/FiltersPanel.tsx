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
  const isNational = filters.dataset === "installed_capacity";
  // Il dataset nazionale non ha geografia: offrire regione e provincia
  // significherebbe proporre filtri che svuotano la dashboard.
  const showRegionFilter = !isNational && filters.geoLevel !== "national";
  const showProvinceFilter = !isNational && filters.geoLevel === "province";

  // Il dataset nazionale parte dal 2021: gli anni precedenti non esistono.
  const minYear = isNational ? (meta.data?.installed_capacity_first_year ?? 2021) : (meta.data?.first_year ?? 2000);
  const maxYear = meta.data?.current_year ?? new Date().getFullYear();

  const regionOptions = toOptions(db.regions ?? []);
  const provinceOptions = toOptions(db.provinces ?? []);
  // Le fonti del dataset scelto, non tutte quelle presenti nel database:
  // "Bioenergie" in Generation plants non esiste e produrrebbe una dashboard vuota.
  const sourceOptions = toOptions(
    isNational
      ? (meta.data?.known_installed_capacity_types ?? db.types ?? [])
      : (meta.data?.dataset_sources?.[filters.dataset] ?? db.sources ?? meta.data?.known_sources ?? []),
  );

  const maxYearFor = (to: number | null | undefined) => (to !== null && to !== undefined ? Math.min(to, maxYear) : maxYear);
  const buildYears = (from: number, to: number) =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({
      label: String(from + i),
      value: String(from + i),
    }));
  // I due menu non possono contraddirsi: "da" non supera "a" e viceversa.
  const yearFromOptions = buildYears(minYear, maxYearFor(filters.year_to));
  const yearToOptions = buildYears(filters.year_from ?? minYear, maxYear).reverse();

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
          value={filters.dataset ?? ""}
          options={DATASET_OPTIONS}
          onChange={(e) => {
            const dataset = e.target.value as DatasetName;
            const national = dataset === "installed_capacity";
            set({
              dataset,
              source: "",
              category: "",
              subcategory: "",
              type: "",
              // Il dataset nazionale non ha geografia né indice di capacità.
              geoLevel: national ? "national" : filters.geoLevel,
              region: "",
              province: "",
              year_from:
                national && (filters.year_from ?? 0) > 0 && (filters.year_from ?? 0) < 2021 ? null : filters.year_from,
              year_to: national && (filters.year_to ?? 0) > 0 && (filters.year_to ?? 0) < 2021 ? null : filters.year_to,
            });
          }}
        />
        {!isNational && (
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
        )}
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
            value={filters.region ?? ""}
            placeholder="All regions"
            options={regionOptions}
            disabled={!regionOptions.length}
            onChange={(e) => set({ region: e.target.value, province: "" })}
          />
        )}
        {showProvinceFilter && (
          <Select
            label="Province"
            value={filters.province ?? ""}
            placeholder="All provinces"
            options={provinceOptions}
            disabled={!provinceOptions.length}
            onChange={(e) => set({ province: e.target.value })}
          />
        )}
        {/* Il dataset termoelettrico non ha una dimensione "fonte": mostrare un
            menu vuoto suggerirebbe un filtro che non esiste. */}
        {sourceOptions.length > 0 && (
          <Select
            label={isNational ? "Type" : "Source"}
            value={isNational ? (filters.type ?? "") : (filters.source ?? "")}
            placeholder="All"
            options={sourceOptions}
            onChange={(e) =>
              isNational ? set({ type: e.target.value, source: "" }) : set({ source: e.target.value })
            }
          />
        )}
        {!isNational && (
          <Select
            label="Capacity type"
            value={filters.capacity_type || "Lorda"}
            options={CAPACITY_OPTIONS}
            onChange={(e) => set({ capacity_type: e.target.value as CapacityType })}
          />
        )}
      </div>
    </div>
  );
}


