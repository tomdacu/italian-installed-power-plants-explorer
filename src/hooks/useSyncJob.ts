import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useToast } from "@/components/ui/Toast";
import type { SyncJobStatus, SyncRequest } from "@/types";

const ACTIVE = new Set(["queued", "running"]);

// Un server più vecchio annunciava "Sync completed" anche con dei passi
// falliti: il messaggio si crede solo quando non contraddice i contatori.
const COMPLETED_CLAIM = /^sync (?:completed|finished|succeeded)\b/i;

/** Il messaggio del job non afferma un successo smentito da `failed_steps`. */
export function syncMessageIsHonest(job: SyncJobStatus): boolean {
  return (job.failed_steps ?? 0) === 0 || !COMPLETED_CLAIM.test((job.message ?? "").trim());
}

/**
 * Conteggio onesto dei passi falliti, nella forma usata da toast e pannello.
 * Non dice *perché* sono falliti: la causa la conosce solo il server.
 */
export function failedStepsSummary(job: SyncJobStatus): string {
  const failed = job.failed_steps ?? 0;
  const total = job.total_steps ?? 0;
  if (total > 0) return `${failed} of ${total} steps failed`;
  return `${failed} step${failed === 1 ? "" : "s"} failed`;
}

/** Perché un job è fallito: l'errore del server, o il suo messaggio se onesto. */
export function syncFailureReason(job: SyncJobStatus): string {
  const error = job.error?.trim();
  if (error) return error;
  if (syncMessageIsHonest(job) && (job.message ?? "").trim()) return job.message.trim();
  return failedStepsSummary(job);
}

/** A job runs on the server; this hook only follows its progress while mounted. */
export function useSyncJob() {
  const qc = useQueryClient();
  const toast = useToast();
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const notifiedJobId = useRef<string | null>(null);

  const latest = useQuery({
    queryKey: ["sync", "latest"],
    queryFn: api.latestSyncStatus,
    refetchOnMount: "always",
    retry: false,
  });
  const jobId = startedJobId ?? latest.data?.job_id ?? null;
  const status = useQuery({
    queryKey: ["sync", "job", jobId],
    queryFn: () => api.syncStatus(jobId!),
    enabled: jobId !== null,
    retry: 5,
    retryDelay: 2500,
    refetchInterval: (query) =>
      !query.state.error && (!query.state.data || ACTIVE.has(query.state.data.status)) ? 1500 : false,
  });
  const job = status.data ?? (latest.data?.job_id === jobId ? latest.data : null);
  const running = job ? ACTIVE.has(job.status) : false;
  const connectionLost = running && status.isError;

  useEffect(() => {
    if (latest.isError) toast.error("Could not load sync status", "Try reopening Data sync.");
  }, [latest.isError, toast]);

  useEffect(() => {
    if (connectionLost) {
      toast.error("Connection lost", "Could not reach the sync service. Reconnect to check the job.");
    }
  }, [connectionLost, toast]);

  useEffect(() => {
    if (!job || running || notifiedJobId.current === job.job_id) return;
    notifiedJobId.current = job.job_id;
    if (job.status === "completed") {
      for (const key of ["metadata", "availability", "summary", "records", "timeseries", "data-quality"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      if (startedJobId === job.job_id) {
        if (job.failed_steps > 0) {
          // Mai "limiti API temporanei": la causa la riporta il job stesso.
          toast.warning(
            "Sync partly completed",
            `${failedStepsSummary(job)}. Retry the download to fill the gaps.`,
          );
        } else {
          toast.success("Sync completed", "The dashboard is up to date.");
        }
      }
    } else if (startedJobId === job.job_id) {
      toast.error("Sync failed", syncFailureReason(job));
    }
  }, [job, running, startedJobId, qc, toast]);

  const start = async (request: SyncRequest): Promise<void> => {
    if (starting || latest.isFetching || running) return;
    setStarting(true);
    try {
      const response = await api.startSync(request);
      notifiedJobId.current = null;
      setStartedJobId(response.job_id);
      toast.info("Sync started", `Job ${response.job_id.slice(0, 8)} queued`);
    } catch (error) {
      toast.error("Sync failed to start", (error as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return {
    job,
    starting,
    running,
    polling: running && !connectionLost,
    loadingExistingJob: !startedJobId && latest.isFetching,
    connectionLost,
    start,
    reconnect: () => void status.refetch(),
  };
}
