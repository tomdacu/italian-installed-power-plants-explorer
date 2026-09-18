import { DatabaseZap, RefreshCw, SearchX } from "lucide-react";
import { Link } from "react-router-dom";
import { DATASET_LABELS } from "@/api/client";
import { useAvailability } from "@/hooks/useMetadata";
import type { DatasetName } from "@/types";

export function ChartEmptyState({ dataset }: { dataset?: DatasetName | "" }) {
  const availability = useAvailability();
  const storedRows = dataset ? availability.data?.datasets[dataset]?.total_rows ?? null : null;
  const needsSync = Boolean(availability.data && dataset && (storedRows === null || storedRows === 0));
  const label = dataset ? DATASET_LABELS[dataset] : "This dataset";

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-2xl border border-ink-200/70 bg-ink-50 p-3.5 text-ink-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-ink-500">
        {needsSync ? <DatabaseZap className="h-6 w-6" /> : <SearchX className="h-6 w-6" />}
      </div>
      <div>
        <p className="font-display text-sm font-semibold text-ink-800 dark:text-ink-100">
          {needsSync ? `${label} is not synced yet` : "No data for the current filters"}
        </p>
        <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">
          {needsSync
            ? "Run a data sync to download this dataset, then return here."
            : "Try widening the year, geography or source filters."}
        </p>
      </div>
      {needsSync && (
        <Link
          to="/sync"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/25 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-500/15 dark:border-brand-400/25 dark:bg-brand-400/10 dark:text-brand-300"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Open data sync
        </Link>
      )}
    </div>
  );
}
