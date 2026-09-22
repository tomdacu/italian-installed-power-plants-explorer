import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  XCircle,
  LoaderCircle,
  CalendarDays,
  Database,
  Gauge,
  Radar,
  CircleCheck,
  TriangleAlert,
  DownloadCloud,
  Info,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { DATASET_LABELS } from "@/api/client";
import { useAvailability, useCredentialStatus, useMetadata } from "@/hooks/useMetadata";
import { useSyncJob } from "@/hooks/useSyncJob";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";
import type { DatasetName, SyncStatus } from "@/types";

const FALLBACK_FIRST_YEAR = 2000;

const STATUS_VARIANT: Record<SyncStatus, "neutral" | "brand" | "success" | "rose"> = {
  queued: "neutral",
  running: "brand",
  completed: "success",
  failed: "rose",
};

const STATUS_ICON: Record<SyncStatus, React.ReactNode> = {
  queued: <RefreshCw className="h-3.5 w-3.5" />,
  running: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
  completed: <CircleCheck className="h-3.5 w-3.5" />,
  failed: <XCircle className="h-3.5 w-3.5" />,
};

const ALL_DATASETS: DatasetName[] = [
  "renewable_source_capacity",
  "generation_plants",
  "installed_capacity",
  "thermoelectric_capacity",
];

function FieldSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">{title}</h3>
          <p className="text-xs text-ink-500 dark:text-ink-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function SyncPage() {
  const toast = useToast();
  const creds = useCredentialStatus();
  const meta = useMetadata();
  const availability = useAvailability();
  const sync = useSyncJob();

  // The default range is what Terna can actually serve: from the first
  // published year (2000) to the last year present in the local cache. The
  // server publishes the same limits, so UI and API cannot drift apart; the
  // current year is only a fallback while the availability cache is empty.
  const firstYear = meta.data?.first_year ?? FALLBACK_FIRST_YEAR;
  const currentYear = meta.data?.current_year ?? new Date().getFullYear();
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");
  // Once a field is edited the defaults must not overwrite it; before that the
  // effect re-seeds both ends as soon as the availability cache answers.
  const yearsEdited = useRef(false);

  useEffect(() => {
    const datasets = Object.values(availability.data?.datasets ?? {});
    const firstStored = availability.data?.datasets.renewable_source_capacity?.year_min ?? null;
    // The latest year Terna has published for any dataset: proposing 2025 or
    // 2026 would only queue steps with nothing to download.
    const lastPublished = datasets.reduce<number | null>(
      (max, dataset) =>
        dataset?.year_max != null && (max === null || dataset.year_max > max) ? dataset.year_max : max,
      null,
    );
    if (yearsEdited.current) return;
    setYearFrom(String(firstStored ?? firstYear));
    setYearTo(String(lastPublished ?? currentYear));
  }, [availability.data, firstYear, currentYear]);

  const startSync = async () => {
    if (sync.loadingExistingJob || sync.starting || sync.running) return;
    if (!creds.data?.configured) {
      toast.error("Configure credentials first", "Add your Terna keys in the Credentials page.");
      return;
    }
    let from = Number(yearFrom);
    let to = Number(yearTo);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      toast.warning("Invalid years", "Enter valid start and end years.");
      return;
    }
    // Stessi limiti del server (`clampYears`): sotto il 2000 Terna non pubblica,
    // sopra l'anno corrente non esiste ancora nulla.
    from = Math.max(firstYear, Math.min(currentYear, from));
    to = Math.max(firstYear, Math.min(currentYear, to));
    const [safeFrom, safeTo] = from <= to ? [from, to] : [to, from];
    yearsEdited.current = true;
    setYearFrom(String(safeFrom));
    setYearTo(String(safeTo));
    const years = Array.from({ length: safeTo - safeFrom + 1 }, (_, i) => safeFrom + i);

    await sync.start({ years, datasets: ALL_DATASETS });
  };

  const job = sync.job;
  const startingUp = sync.starting && !job;
  const pct = job ? Math.round((job.completed_steps / Math.max(1, job.total_steps)) * 100) : 0;

  return (
    <div>
      <Topbar
        title="Data sync"
        subtitle="Download all Terna capacity data, then explore it on the dashboard"
        actions={
          <Button variant="primary" className="h-9" onClick={startSync} loading={sync.starting} disabled={sync.loadingExistingJob || sync.running}>
            <RefreshCw className={cn("h-4 w-4", sync.polling && "animate-spin")} /> Download everything
          </Button>
        }
      />
      <div className="mx-auto max-w-[1400px] animate-fade-in p-6 pt-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <FieldSection
              icon={CalendarDays}
              title="Years"
              description="Every year in the range is downloaded for all datasets."
            >
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label="From"
                  type="number"
                  value={yearFrom}
                  onChange={(e) => {
                    yearsEdited.current = true;
                    setYearFrom(e.target.value);
                  }}
                  className="h-9 max-w-[140px]"
                />
                <Input
                  label="To"
                  type="number"
                  value={yearTo}
                  onChange={(e) => {
                    yearsEdited.current = true;
                    setYearTo(e.target.value);
                  }}
                  className="h-9 max-w-[140px]"
                />
                <Button variant="outline" size="sm" className="h-9" onClick={startSync} loading={sync.starting} disabled={sync.loadingExistingJob || sync.running}>
                  <DownloadCloud className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  One request per dataset and year brings back every source and both capacity
                  types (Lorda/Netta) — a full multi-year sync is only a few MB. You pick what to
                  look at on the dashboard. Note: national installed capacity is only published from
                  2021 onwards, so those earlier years are skipped for that dataset.
                </span>
              </p>
            </FieldSection>

            <FieldSection
              icon={Database}
              title="What is stored locally"
              description="Per dataset and year, from your local database."
            >
              {availability.isLoading ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">Loading…</p>
              ) : availability.isError ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Could not reach the local data service. Start a download to populate the database.
                </p>
              ) : !availability.data || availability.data.total_rows === 0 ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Nothing stored yet. Press “Download everything” to fetch the data from Terna.
                </p>
              ) : (
                <div className="space-y-3">
                  {ALL_DATASETS.map((d) => {
                    const entry = availability.data?.datasets[d];
                    if (!entry) return null;
                    return (
                      <div key={d} className="surface p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                            {DATASET_LABELS[d]}
                          </p>
                          <span className="font-mono text-xs text-ink-500 dark:text-ink-400">
                            {formatNumber(entry.total_rows)} rows
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entry.years.map((y) => (
                            <span
                              key={y.year}
                              title={`${formatNumber(y.rows)} rows`}
                              className="chip border-brand-500/30 bg-brand-500/10 font-mono text-[11px] text-brand-700 dark:border-brand-400/25 dark:bg-brand-400/10 dark:text-brand-300"
                            >
                              {y.year}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </FieldSection>
          </div>

          <div className="space-y-4">
            <section className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
                    <Radar className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">Job status</h3>
                    <p className="text-xs text-ink-500 dark:text-ink-400">Live progress of the current sync.</p>
                  </div>
                </div>
                {job && (
                  <div className="flex items-center gap-2">
                    {sync.connectionLost && (
                      <Button variant="outline" size="sm" onClick={sync.reconnect}>Reconnect</Button>
                    )}
                    <Badge variant={STATUS_VARIANT[job.status]}>
                      {STATUS_ICON[job.status]} {job.status}
                    </Badge>
                  </div>
                )}
              </div>

              {!job ? (
                <div className="surface grid h-48 place-items-center text-center">
                  <div className="flex max-w-xs flex-col items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-100 text-ink-600 dark:bg-white/[0.05] dark:text-ink-400">
                      <Gauge className="h-5 w-5" />
                    </span>
                    <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                      {startingUp ? "Starting the sync…" : "No active sync."} Press{" "}
                      <span className="font-semibold text-ink-800 dark:text-ink-100">Download everything</span> to fetch the
                      latest records from Terna.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Progress value={job.completed_steps} max={Math.max(1, job.total_steps)} />
                  <div className="flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
                    <span>
                      {job.completed_steps} / {job.total_steps} steps
                    </span>
                    <span className="font-mono font-semibold text-ink-700 dark:text-ink-200">{pct}%</span>
                  </div>
                  <p className="surface p-3.5 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
                    {job.message}
                  </p>
                  {job.status === "failed" && job.error && (
                    <p className="rounded-xl border border-rose-200/80 bg-rose-50/80 p-3.5 text-sm leading-relaxed text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                      {job.error}
                    </p>
                  )}
                  {job.status === "completed" && (job.failed_steps ?? 0) > 0 && (
                    <p className="flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-100/60 p-3.5 text-sm leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {job.failed_steps} step{job.failed_steps === 1 ? "" : "s"} skipped due to temporary API
                        limits. Start another sync to fill the gaps — already downloaded data is safe.
                      </span>
                    </p>
                  )}
                  {job.status === "completed" &&
                    (job.failed_steps ?? 0) === 0 &&
                    (job.empty_steps ?? 0) === 0 &&
                    (job.skipped_steps ?? 0) > 0 && (
                      <p className="flex items-start gap-2 rounded-xl border border-ink-200/70 bg-ink-50/60 p-3.5 text-sm leading-relaxed text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-300">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {job.skipped_steps} step{job.skipped_steps === 1 ? "" : "s"} skipped: those
                          years are not published for the selected datasets (the national series
                          starts in 2021). Everything there is to download was downloaded.
                        </span>
                      </p>
                    )}

                  {job.status === "completed" && (job.failed_steps ?? 0) === 0 && (job.empty_steps ?? 0) > 0 && (
                    <p className="flex items-start gap-2 rounded-xl border border-ink-200/70 bg-ink-50/60 p-3.5 text-sm leading-relaxed text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-300">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {job.empty_steps} step{job.empty_steps === 1 ? "" : "s"} returned no data (years Terna
                        has not published yet, or combinations with nothing to report). Everything
                        available was downloaded.
                      </span>
                    </p>
                  )}
                  {job.status === "completed" &&
                    (job.failed_steps ?? 0) === 0 &&
                    (job.empty_steps ?? 0) === 0 &&
                    (job.skipped_steps ?? 0) === 0 && (
                      <p className="flex items-center gap-2 rounded-xl border border-brand-500/20 bg-brand-500/[0.07] p-3.5 text-sm text-brand-700 dark:text-brand-300">
                        <CircleCheck className="h-4 w-4 shrink-0" /> All done — every chart and table now includes the new data.
                      </p>
                    )}
                </div>
              )}
            </section>

            <section className="card p-5">
              <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                <span className="font-semibold text-ink-800 dark:text-ink-100">Tip.</span> Each year
                needs one request per dataset, paced at about one per second to stay inside Terna&apos;s
                limits: four years of everything takes roughly half a minute. Keep the app open while
                it runs — you can explore previously synced data on the dashboard in the meantime.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
