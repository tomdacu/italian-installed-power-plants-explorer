import { CircleCheck, Gauge, Info, LoaderCircle, Radar, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Section } from "@/components/sync/Section";
import { failedStepsSummary, syncMessageIsHonest, syncFailureReason } from "@/lib/sync-messages";
import type { SyncJobStatus, SyncStatus } from "@/types";

const STATUS_VARIANT: Record<SyncStatus, "neutral" | "brand" | "success" | "rose"> = {
  queued: "neutral",
  running: "brand",
  completed: "success",
  failed: "rose",
  // Cancellare è una scelta dell'utente, non un guasto: resta neutro.
  cancelled: "neutral",
};

const STATUS_ICON: Record<SyncStatus, React.ReactNode> = {
  queued: <RefreshCw className="h-3.5 w-3.5" />,
  running: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
  completed: <CircleCheck className="h-3.5 w-3.5" />,
  failed: <XCircle className="h-3.5 w-3.5" />,
  cancelled: <XCircle className="h-3.5 w-3.5" />,
};

interface Props {
  job: SyncJobStatus | null;
  /** Il job è stato chiesto e il server non l'ha ancora confermato. */
  startingUp: boolean;
  running: boolean;
  cancelling: boolean;
  connectionLost: boolean;
  onCancel: () => void;
  onReconnect: () => void;
}

/** Pannello del job: stato, contatori e perché è finito come è finito. */
export function JobStatusPanel({
  job,
  startingUp,
  running,
  cancelling,
  connectionLost,
  onCancel,
  onReconnect,
}: Props) {
  const pct = job ? Math.round((job.completed_steps / Math.max(1, job.total_steps)) * 100) : 0;
  // Job concluso con dei passi falliti: i contatori li dà il job, la causa solo
  // se il server la riporta davvero.
  const partlyFailed = job?.status === "completed" && (job.failed_steps ?? 0) > 0;

  return (
    <Section
      icon={Radar}
      title="Job status"
      description="Live progress of the current sync."
      actions={
        job ? (
          <div className="flex items-center gap-2">
            {connectionLost && (
              <Button variant="outline" size="sm" onClick={onReconnect}>Reconnect</Button>
            )}
            {running && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onCancel()}
                loading={cancelling}
              >
                <XCircle className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
            <Badge variant={STATUS_VARIANT[job.status]}>
              {STATUS_ICON[job.status]} {job.status}
            </Badge>
          </div>
        ) : null
      }
    >
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
          <Progress value={job.completed_steps} max={Math.max(1, job.total_steps)} label="Sync progress" />
          <div className="flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
            <span>
              {job.completed_steps} / {job.total_steps} steps
            </span>
            <span className="font-mono font-semibold text-ink-700 dark:text-ink-200">{pct}%</span>
          </div>
          {/* Cancellato: né rosso (non è un guasto) né "completed"
              (i passi che mancavano non ci sono). Il messaggio grezzo
              del server lascia il posto a questo, che è più preciso. */}
          {job.status === "cancelled" ? (
            <p className="flex items-start gap-2 rounded-xl border border-ink-200/70 bg-ink-50/60 p-3.5 text-sm leading-relaxed text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">Sync cancelled.</span> {job.completed_steps} of{" "}
                {job.total_steps} steps had already completed and are kept; start another sync
                to download the rest.
              </span>
            </p>
          ) : (
            <p className="surface p-3.5 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
              {/* Un server più vecchio annunciava "Sync completed" anche con
                  dei passi falliti: quel messaggio non va mostrato. */}
              {partlyFailed && !syncMessageIsHonest(job)
                ? failedStepsSummary(job)
                : job.message}
            </p>
          )}
          {job.status === "failed" && (
            <p className="rounded-xl border border-rose-200/80 bg-rose-50/80 p-3.5 text-sm leading-relaxed text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
              {syncFailureReason(job)}
            </p>
          )}
          {partlyFailed && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-100/60 p-3.5 text-sm leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">{failedStepsSummary(job)}</span>
                {job.error ? ` — ${job.error}` : ""}. Start another sync to fill the gaps —
                already downloaded data is safe.
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
                  {job.skipped_steps} step{job.skipped_steps === 1 ? "" : "s"} skipped: outside
                  the requested range or not published by the selected datasets. Everything
                  there is to download was downloaded.
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
    </Section>
  );
}
