/**
 * CSV di ogni grafico: una tabella per il bottone della card, costruita dalla
 * stessa serie che il grafico disegna. Funzioni pure, così l'export si può
 * provare senza browser e le card non contengono logica di serializzazione.
 */
import { csvNumber, type CsvTable } from "@/lib/csv";
import type { AreaSeries, GrowthData, YearlySplit } from "@/lib/chart-data";
import type { AggregatePoint } from "@/types";

/** Nome della colonna dei valori: l'unità fa parte del nome, come negli altri export. */
export function measureCsvKey(isGw: boolean): string {
  return isGw ? "installed_capacity_gw" : "installed_capacity_mw";
}

/** Capacity over time: anno, serie e valore dello stock. */
export function yearlySplitCsv(split: YearlySplit): CsvTable {
  const valueKey = measureCsvKey(split.measure.isGw);
  const rows: Record<string, unknown>[] = [];
  for (const entry of split.data) {
    for (const name of split.names) {
      const value = entry[name];
      if (typeof value !== "number") continue;
      rows.push({ year: Number(entry.year), [split.splitKey]: name, [valueKey]: csvNumber(value) });
    }
  }
  return {
    columns: [
      { key: "year", label: "year" },
      { key: split.splitKey, label: split.splitKey },
      { key: valueKey, label: valueKey },
    ],
    rows,
  };
}

/** Source mix: gli stessi dati più la quota di quella serie nell'anno. */
export function sourceMixCsv(split: YearlySplit): CsvTable {
  const valueKey = measureCsvKey(split.measure.isGw);
  const totals = new Map<number, number>();
  for (const entry of split.data) {
    const year = Number(entry.year);
    totals.set(
      year,
      split.names.reduce((sum, name) => sum + ((entry[name] as number | undefined) ?? 0), 0),
    );
  }

  const rows: Record<string, unknown>[] = [];
  for (const entry of split.data) {
    const year = Number(entry.year);
    const total = totals.get(year) ?? 0;
    for (const name of split.names) {
      const value = entry[name];
      if (typeof value !== "number") continue;
      rows.push({
        year,
        [split.splitKey]: name,
        [valueKey]: csvNumber(value),
        share_percent: total > 0 ? csvNumber((value / total) * 100) : null,
      });
    }
  }

  return {
    columns: [
      { key: "year", label: "year" },
      { key: split.splitKey, label: split.splitKey },
      { key: valueKey, label: valueKey },
      { key: "share_percent", label: "share_percent" },
    ],
    rows,
  };
}

/** Annual additions: il cambiamento anno su anno di ogni serie. */
export function additionsCsv(growth: GrowthData, splitKey: string): CsvTable {
  const valueKey = growth.measure.isGw ? "added_gw" : "added_mw";
  const rows: Record<string, unknown>[] = [];
  for (const entry of growth.rows) {
    for (const name of growth.names) {
      const value = entry[name];
      if (typeof value !== "number") continue;
      rows.push({ year: entry.year, [splitKey]: name, [valueKey]: csvNumber(value) });
    }
  }
  return {
    columns: [
      { key: "year", label: "year" },
      { key: splitKey, label: splitKey },
      { key: valueKey, label: valueKey },
    ],
    rows,
  };
}

/** Capacity by source: un valore per serie, nell'ultimo anno della selezione. */
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

/**
 * Capacity by area: una riga per area e fonte, con il valore e la quota di
 * quella fonte nell'area. Tutte le aree della selezione, non solo le disegnate.
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
