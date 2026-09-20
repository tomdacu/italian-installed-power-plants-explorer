import { TriangleAlert } from "lucide-react";
import { useDataQuality } from "@/hooks/useMetadata";
import type { RecordFilters } from "@/types";

/** Below this many empty cells the year total is not meaningfully affected. */
const NOISE_FLOOR = 3;

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

  const years = partial.map((year) => year.year).join(", ");
  const cells = partial.reduce((sum, year) => sum + year.missing_values, 0);
  const single = partial.length === 1;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">Partial data in {years}.</span>{" "}
        Terna&apos;s files for {single ? "this year" : "these years"} leave {cells} value
        {cells === 1 ? "" : "s"} empty, so the stock for {single ? "that year" : "those years"} is
        understated — and any year-on-year change across {single ? "it" : "them"} is overstated. The{" "}
        <span className="font-medium">Generation plants</span> dataset carries the complete series
        (it counts pumped-storage hydro, so its hydro total is higher). Year-by-year check against
        Terna&apos;s yearbook: <span className="font-mono text-xs">docs/data-validation.md</span>.
      </p>
    </div>
  );
}
