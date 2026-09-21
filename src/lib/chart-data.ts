/**
 * Trasformazioni pure condivise dai grafici: misura del dataset, pivot per
 * anno/fonte, ripartizione per area e addizioni annue. Nessun React qui: così
 * le stesse funzioni si possono provare da sole (e i grafici restano solo
 * disegno).
 */
import { formatGw, formatMw } from "@/lib/utils";
import type { AggregatePoint, RecordFilters } from "@/types";

export type SeriesRow = Record<string, number | string>;

export interface Measure {
  isGw: boolean;
  valueKey: "efficient_power_mw" | "installed_capacity_gw";
  unit: "MW" | "GW";
  format: (value: number | null | undefined) => string;
}

/** Ogni dataset porta la sua unità: il nazionale misura in GW, il resto in MW. */
export function measureFor(filters: RecordFilters): Measure {
  const isGw = filters.dataset === "installed_capacity";
  return {
    isGw,
    valueKey: isGw ? "installed_capacity_gw" : "efficient_power_mw",
    unit: isGw ? "GW" : "MW",
    format: isGw ? formatGw : formatMw,
  };
}

export interface YearlySplit {
  splitKey: string;
  measure: Measure;
  data: SeriesRow[];
  names: string[];
}

export interface YearlySplitCell {
  year: number;
  name: string;
  value: number;
}

/** Una cella per anno e serie: gli stessi numeri da cui nasce la pila. */
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

export interface GrowthData {
  rows: Record<string, number>[];
  names: string[];
  measure: Measure;
}

/**
 * Addizioni annue: differenza fra anni **consecutivi**. Un buco nella serie non
 * è un anno, e presentare un delta pluriennale come "additions" di un solo anno
 * sarebbe semplicemente falso: quelle coppie si saltano.
 */
export function yearlyAdditions(split: YearlySplit): GrowthData | null {
  if (split.data.length < 2) return null;
  const rows: Record<string, number>[] = [];

  for (let index = 1; index < split.data.length; index += 1) {
    const previous = split.data[index - 1];
    const current = split.data[index];
    if (Number(current.year) - Number(previous.year) !== 1) continue;

    const row: Record<string, number> = { year: Number(current.year) };
    for (const name of split.names) {
      row[name] =
        ((current[name] as number | undefined) ?? 0) - ((previous[name] as number | undefined) ?? 0);
    }
    rows.push(row);
  }

  return rows.length > 0 ? { rows, names: split.names, measure: split.measure } : null;
}

/** Una riga della tabella per area: una colonna per serie. */
export interface AreaRow {
  area: string;
  total: number;
  [series: string]: number | string;
}

export interface AreaSeries {
  rows: AreaRow[];
  /** Serie presenti, dalla più grande alla più piccola. */
  names: string[];
}

/** Raggruppa le righe (area, serie) in una riga per area, con i totali. */
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
