import { TriangleAlert } from "lucide-react";
import { useDataQuality } from "@/hooks/useMetadata";
import type { RecordFilters } from "@/types";

/** Under this many empty cells a year total is not meaningfully affected. */
const NOISE_FLOOR = 3;

function describeRun(from: number, to: number): string {
  return from === to ? String(from) : `${from}–${to}`;
}

/**
 * "2003–2006, 2008–2010": every run of consecutive years is kept separate, so a
 * range never reads as if it covered a year that is missing from the list.
 */
function describeYears(years: number[]): string {
  const sorted = [...years].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const year of sorted.slice(1)) {
    if (year === previous + 1) {
      previous = year;
      continue;
    }
    runs.push(describeRun(start, previous));
    start = year;
    previous = year;
  }
  runs.push(describeRun(start, previous));
  if (runs.length === 1) return runs[0];
  return `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`;
}

/**
 * Terna publishes some year files with empty cells (a province/source/index
 * combination left blank even though it carries a value in another year). A
 * year total that skips them is understated, which in turn inflates the
 * year-on-year change of the following year. Rather than quietly showing the
 * wrong number, the dashboard names the affected years.
 */
export function DataQualityNote({ filters }: { filters: RecordFilters }) {
  const quality = useDataQuality(filters);
  const partial = (quality.data?.years ?? []).filter((year) => year.missing_values >= NOISE_FLOOR);

  if (partial.length === 0) return null;

  const years = partial.map((year) => year.year);
  const cells = partial.reduce((sum, year) => sum + year.missing_values, 0);
  const single = years.length === 1;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">
          Partial data in {single ? years[0] : describeYears(years)}.
        </span>{" "}
        Terna&apos;s files for {single ? "that year" : "those years"} leave {cells} value
        {cells === 1 ? "" : "s"} empty, so the stock is understated — and any year-on-year change
        across {single ? "it" : "them"} is overstated. Only years with at least {NOISE_FLOOR} empty
        cells are flagged: below that the yearly total is not materially affected. The{" "}
        <span className="font-medium">Generation plants</span> dataset carries the complete series
        (it counts pumped-storage hydro, so its hydro total is higher). Year-by-year check against
        Terna&apos;s yearbook: <span className="font-mono text-xs">docs/data-validation.md</span>.
      </p>
    </div>
  );
}
