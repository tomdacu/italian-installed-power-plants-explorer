import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { api, DATASET_LABELS } from "@/api/client";
import { useAvailability, useCredentialStatus, useMetadata } from "@/hooks/useMetadata";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";
import type { DatasetName, SyncJobStatus, SyncStatus } from "@/types";

const FALLBACK_FIRST_YEAR = 2000;

const MAX_POLL_ERRORS = 5;

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
  const qc = useQueryClient();
  const toast = useToast();
  const creds = useCredentialStatus();
  const meta = useMetadata();
  const availability = useAvailability();

  // Il range di default è quello che Terna può servire davvero: dal primo anno
  // pubblicato (2000) all'anno corrente. Gli stessi limiti arrivano dal server,
  // così UI e API non possono divergere; qui c'è solo un valore di riserva.
  const firstYear = meta.data?.first_year ?? FALLBACK_FIRST_YEAR;
  const currentYear = meta.data?.current_year ?? new Date().getFullYear();
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");

  useEffect(() => {
    const years = availability.data?.datasets.renewable_source_capacity?.year_min;
    setYearFrom((current) => current || String(years ?? firstYear));
    setYearTo((current) => current || String(currentYear));
  }, [availability.data, firstYear, currentYear]);

  const [job, setJob] = useState<SyncJobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [polling, setPolling] = useState(false);

  // Polling bookkeeping — the timer must not survive unmounts, repeated
  // errors must stop the loop, and a new sync must invalidate the old one.
  const pollTimer = useRef<number | null>(null);
  const pollErrors = useRef(0);
  const pollJobId = useRef<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    // Re-arm on every mount: React StrictMode mounts, unmounts and remounts
    // the component in development, and a ref never reset here would keep the
    // poll loop permanently disabled.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollTimer.current !== null) {
        window.clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, []);

  const invalidateDataQueries = () => {
    qc.invalidateQueries({ queryKey: ["metadata"] });
    qc.invalidateQueries({ queryKey: ["availability"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["records"] });
    qc.invalidateQueries({ queryKey: ["timeseries"] });
    qc.invalidateQueries({ queryKey: ["data-quality"] });
  };

  const startSync = async () => {
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
    setYearFrom(String(safeFrom));
    setYearTo(String(safeTo));
    const years = Array.from({ length: safeTo - safeFrom + 1 }, (_, i) => safeFrom + i);

    setStarting(true);
    setJob(null);
    pollErrors.current = 0;
    try {
      // Un passo per dataset e anno: le fonti e gli indici arrivano tutti
      // insieme nella stessa risposta, quindi non c'è nulla da scegliere qui.
      const res = await api.startSync({ years, datasets: ALL_DATASETS });
      toast.info("Sync started", `Job ${res.job_id.slice(0, 8)} queued`);
      // Cancel any previous poll loop, then track the new job id so stale
      // responses can never drive the UI.
      pollJobId.current = res.job_id;
      if (pollTimer.current !== null) {
        window.clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
      poll(res.job_id);
    } catch (e) {
      toast.error("Sync failed to start", (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const poll = (jobId: string) => {
    setPolling(true);
    const tick = async () => {
      if (!aliveRef.current || pollJobId.current !== jobId) return;
      try {
        const next = await api.syncStatus(jobId);
        if (!aliveRef.current || pollJobId.current !== jobId) return;
        pollErrors.current = 0;
        setJob(next);
        if (next.status === "running" || next.status === "queued") {
          pollTimer.current = window.setTimeout(tick, 1500);
        } else {
          setPolling(false);
          if (next.status === "completed") {
            toast.success("Sync completed", "The dashboard is up to date.");
            invalidateDataQueries();
          } else {
            toast.error("Sync failed", next.error ?? next.message);
          }
        }
      } catch {
        if (!aliveRef.current || pollJobId.current !== jobId) return;
        pollErrors.current += 1;
        if (pollErrors.current <= MAX_POLL_ERRORS) {
          pollTimer.current = window.setTimeout(tick, 2500);
        } else {
          setPolling(false);
          toast.error(
            "Connection lost",
            "Could not reach the sync service. The job may still be running — try starting a new sync.",
          );
        }
      }
    };
    void tick();
  };

  const running = job && (job.status === "running" || job.status === "queued");
  const startingUp = starting && !job;
  const pct = job ? Math.round((job.completed_steps / Math.max(1, job.total_steps)) * 100) : 0;

  return (
    <div>
      <Topbar
        title="Data sync"
        subtitle="Download all Terna capacity data, then explore it on the dashboard"
        actions={
          <Button variant="primary" className="h-9" onClick={startSync} loading={starting} disabled={!!running || polling}>
            <RefreshCw className={cn("h-4 w-4", polling && "animate-spin")} /> Download everything
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
                  onChange={(e) => setYearFrom(e.target.value)}
                  className="h-9 max-w-[140px]"
                />
                <Input
                  label="To"
                  type="number"
                  value={yearTo}
                  onChange={(e) => setYearTo(e.target.value)}
                  className="h-9 max-w-[140px]"
                />
                <Button variant="outline" size="sm" className="h-9" onClick={startSync} loading={starting} disabled={!!running || polling}>
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
                <p className="text-sm text-ink-400">Loading…</p>
              ) : availability.isError ? (
                <p className="text-sm text-ink-400">
                  Could not reach the local data service. Start a download to populate the database.
                </p>
              ) : !availability.data || availability.data.total_rows === 0 ? (
                <p className="text-sm text-ink-400">
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
                  <Badge variant={STATUS_VARIANT[job.status]}>
                    {STATUS_ICON[job.status]} {job.status}
                  </Badge>
                )}
              </div>

              {!job ? (
                <div className="surface grid h-48 place-items-center text-center">
                  <div className="flex max-w-xs flex-col items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-white/[0.05]">
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
                  {job.status === "completed" && (job.failed_steps ?? 0) === 0 && (job.empty_steps ?? 0) === 0 && (
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
