import { DATASET_LABELS } from "@/api/client";
import { formatNumber } from "@/lib/utils";
import type { Availability, DatasetName } from "@/types";

interface Props {
  availability: Availability;
  datasets: readonly DatasetName[];
}

/** A compact shared timeline makes gaps and shorter datasets easy to compare. */
export function StoredDataOverview({ availability, datasets }: Props) {
  const entries = datasets
    .map((name) => ({ name, data: availability.datasets[name] }))
    .filter((entry): entry is { name: DatasetName; data: NonNullable<typeof entry.data> } => Boolean(entry.data));
  const years = entries.flatMap(({ data }) => data.years.map(({ year }) => year));
  if (years.length === 0) return null;

  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const timeline = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200/70 dark:border-white/[0.08]">
      <div className="flex items-end justify-between gap-3 bg-gradient-to-r from-brand-500/[0.12] to-brand-500/[0.03] px-4 py-3.5 dark:from-brand-400/[0.12] dark:to-transparent">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Local cache
          </p>
          <p className="mt-1 font-display text-xl font-semibold leading-none tabular-nums text-ink-900 dark:text-white">
            {formatNumber(availability.total_rows)} <span className="text-xs font-medium text-ink-500 dark:text-ink-400">rows</span>
          </p>
        </div>
        <p className="text-right text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          {entries.length} datasets<br />through <span className="font-mono font-semibold text-ink-700 dark:text-ink-200">{lastYear}</span>
        </p>
      </div>

      <div className="divide-y divide-ink-200/60 bg-white/50 dark:divide-white/[0.06] dark:bg-ink-900/30">
        {entries.map(({ name, data }) => {
          const byYear = new Map(data.years.map((item) => [item.year, item.rows]));
          const first = data.year_min ?? data.years[0].year;
          const last = data.year_max ?? data.years[data.years.length - 1].year;
          return (
            <div key={name} className="px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm font-semibold text-ink-800 dark:text-ink-100">{DATASET_LABELS[name]}</p>
                <p className="shrink-0 font-mono text-xs tabular-nums text-ink-500 dark:text-ink-400">
                  {formatNumber(data.total_rows)} <span className="font-sans">rows</span>
                </p>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-medium tabular-nums text-brand-700 dark:text-brand-300">
                  {first}–{last}
                </span>
                <span className="text-ink-500 dark:text-ink-400">
                  {data.years.length} {data.years.length === 1 ? "year" : "years"} available
                </span>
              </div>
              <div
                role="img"
                aria-label={`${DATASET_LABELS[name]}: ${data.years.length} years available from ${first} to ${last}`}
                className="mt-2 grid h-2 gap-1"
                style={{ gridTemplateColumns: `repeat(${timeline.length}, minmax(0, 1fr))` }}
              >
                {timeline.map((year) => {
                  const rows = byYear.get(year);
                  return (
                    <span
                      key={year}
                      title={rows === undefined ? `${year}: no data` : `${year}: ${formatNumber(rows)} rows`}
                      className={rows === undefined
                        ? "rounded-sm bg-ink-200/80 dark:bg-white/[0.09]"
                        : "rounded-sm bg-brand-500 dark:bg-brand-400"}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
