import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useToast } from "@/components/ui/Toast";
import type { SyncJobStatus, SyncRequest } from "@/types";

const ACTIVE = new Set(["queued", "running"]);

/**
 * Ritmo e durata dell'assestamento dopo una cancellazione.
 *
 * Il server legge la cancellazione **fra un passo e l'altro**: quello in volo
 * finisce comunque, e i contatori del job si muovono ancora per qualche
 * secondo. Il pannello deve arrivare al conteggio vero senza che l'utente
 * ricarichi la pagina, quindi si continua a interrogare il job finché i
 * contatori non stanno fermi per `SETTLE_QUIET_MS`, con un tetto di letture.
 */
const SETTLE_POLL_MS = 1500;
const SETTLE_QUIET_MS = 5000;
const SETTLE_MAX_POLLS = 12;

/** I contatori che possono muoversi ancora dopo una cancellazione. */
function counters(job: SyncJobStatus): string {
  return `${job.completed_steps}/${job.failed_steps}/${job.empty_steps}/${job.message}`;
}

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
  const [cancelling, setCancelling] = useState(false);
  /**
   * La guardia vera di "una sync alla volta". Fra il click e il commit di React
   * passa un frame in cui `starting` è ancora false: un secondo click in quella
   * finestra faceva partire un secondo job. Il ref è già vero nel tick del
   * click; `starting` resta lo specchio per il rendering (`disabled`, spinner).
   */
  const startingRef = useRef(false);
  const markStarting = (value: boolean) => {
    startingRef.current = value;
    setStarting(value);
  };
  // Job cancellato i cui contatori possono ancora muoversi (passo in volo).
  const [settlingJobId, setSettlingJobId] = useState<string | null>(null);
  const notifiedJobId = useRef<string | null>(null);
  const settling = useRef<{ id: string; counters: string; lastChangeAt: number; polls: number } | null>(null);

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
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const data = query.state.data;
      // Nessun dato (o job attivo): si segue. Job finito: si smette, tranne se
      // è quello appena cancellato e i suoi contatori stanno ancora girando.
      if (!data || ACTIVE.has(data.status)) return SETTLE_POLL_MS;
      return settlingJobId === data.job_id ? SETTLE_POLL_MS : false;
    },
  });
  const job = status.data ?? (latest.data?.job_id === jobId ? latest.data : null);
  const running = job ? ACTIVE.has(job.status) : false;
  const connectionLost = running && status.isError;
  /**
   * Una sola verità per "adesso non si può far partire un'altra sync": la usano
   * la guardia di `start` e l'attributo `disabled` dei bottoni. `starting` resta
   * vero finché la query di stato del job appena creato non ha risposto —
   * altrimenti, fra la risposta del POST e il primo stato, il pannello non sa
   * ancora che il job esiste e un secondo click ne faceva partire un altro.
   * `!startedJobId && latest.isFetching` è il primo caricamento (job già in
   * corso sul server): finché non si sa cosa sta girando non si parte.
   */
  const busy = starting || running || (!startedJobId && latest.isFetching);

  // Il job appena creato esiste per il server: appena lo stato (o l'ultimo job)
  // lo conferma, `job`/`running` prendono il comando.
  useEffect(() => {
    if (!starting || startedJobId === null) return;
    if (status.data?.job_id === startedJobId || latest.data?.job_id === startedJobId || status.isError) {
      markStarting(false);
    }
  }, [starting, startedJobId, status.data, status.isError, latest.data]);

  // Dopo una cancellazione si smette di interrogare il job solo quando i suoi
  // contatori sono fermi da un po' (o quando il tetto di letture è raggiunto).
  useEffect(() => {
    const state = settling.current;
    if (!state || status.data?.job_id !== state.id) return;
    state.polls += 1;
    const now = counters(status.data);
    if (now !== state.counters) {
      state.counters = now;
      state.lastChangeAt = Date.now();
      return;
    }
    if (state.polls >= SETTLE_MAX_POLLS || Date.now() - state.lastChangeAt >= SETTLE_QUIET_MS) {
      settling.current = null;
      setSettlingJobId(null);
    }
  }, [status.data, status.dataUpdatedAt]);

  useEffect(() => {
    if (latest.isError) {
      // "Try reopening Data sync" incolpava la pagina quando la causa è il
      // servizio locale spento: il testo dice quello che sappiamo davvero.
      toast.error(
        "Could not load sync status",
        "The local data service is not responding. If the app was just opened, give it a few seconds.",
      );
    }
  }, [latest.isError, toast]);

  useEffect(() => {
    if (connectionLost) {
      toast.error("Connection lost", "Could not reach the sync service. Reconnect to check the job.");
    }
  }, [connectionLost, toast]);

  useEffect(() => {
    if (!job || running || notifiedJobId.current === job.job_id) return;
    notifiedJobId.current = job.job_id;
    if (job.status === "completed" || job.status === "cancelled") {
      // I passi già completati hanno scritto nel database: la dashboard va
      // riletta anche dopo una cancellazione.
      for (const key of ["metadata", "availability", "summary", "records", "timeseries", "data-quality"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      if (startedJobId === job.job_id) {
        if (job.status === "cancelled") {
          // Cancellare non è un errore: nessun toast rosso, e nessuna
          // affermazione di successo.
          toast.info(
            "Sync cancelled",
            `${job.completed_steps} of ${job.total_steps} steps had already completed and are kept.`,
          );
        } else if (job.failed_steps > 0) {
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
    if (startingRef.current || busy) return;
    markStarting(true);
    try {
      const response = await api.startSync(request);
      notifiedJobId.current = null;
      setStartedJobId(response.job_id);
      toast.info("Sync started", `Job ${response.job_id.slice(0, 8)} queued`);
      // Niente `finally`: `starting` resta vero finché lo stato del job creato
      // non risponde (l'effetto qui sopra lo abbassa). È la finestra in cui un
      // doppio click faceva partire un secondo job.
    } catch (error) {
      markStarting(false);
      toast.error("Sync failed to start", (error as Error).message);
    }
  };

  /**
   * Chiede al server di fermare il job fra un passo e l'altro.
   *
   * Due esiti possibili: se il server ha già un altro job attivo il pannello lo
   * adotta e il messaggio lo dice (cancellare questo non ferma quello); se non
   * c'è nessun altro job lo stato cancellato lo annuncia l'effetto qui sopra,
   * mentre i contatori continuano a essere letti finché il passo in volo non si
   * chiude — così il pannello arriva al conteggio vero senza ricaricare.
   */
  const cancel = async (): Promise<void> => {
    if (jobId === null || cancelling) return;
    const cancelledId = jobId;
    setCancelling(true);
    try {
      const updated = await api.cancelSync(cancelledId);
      // Da qui il job cancellato lo racconta questa funzione: l'effetto non deve
      // annunciare "Sync cancelled" mentre si sta ancora decidendo se un altro
      // job è in corso.
      notifiedJobId.current = cancelledId;
      const other = await api.latestSyncStatus().catch(() => null);
      if (other && other.job_id !== cancelledId && ACTIVE.has(other.status)) {
        // Il server ha un altro job attivo (coda): cancellare questo non ferma
        // quello. Il pannello lo adotta e il messaggio lo dice, invece di
        // lasciare l'utente convinto che non stia scaricando più niente.
        notifiedJobId.current = null;
        setStartedJobId(other.job_id);
        qc.setQueryData(["sync", "latest"], other);
        qc.setQueryData(["sync", "job", other.job_id], other);
        toast.info(
          "Another sync is running",
          `Job ${cancelledId.slice(0, 8)} was cancelled, but job ${other.job_id.slice(0, 8)} is already running — this page now follows it.`,
        );
        return;
      }
      // Nessun altro job: si annuncia la cancellazione (contatori finali, via
      // effetto) e si continua a leggere il job finché il passo in volo non si
      // chiude, così il conteggio mostrato è quello vero.
      notifiedJobId.current = null;
      qc.setQueryData(["sync", "job", cancelledId], updated);
      void qc.invalidateQueries({ queryKey: ["sync", "latest"] });
      settling.current = { id: cancelledId, counters: counters(updated), lastChangeAt: Date.now(), polls: 0 };
      setSettlingJobId(cancelledId);
    } catch (error) {
      toast.error("Could not cancel the sync", (error as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  return {
    job,
    starting,
    cancelling,
    running,
    busy,
    polling: running && !connectionLost,
    connectionLost,
    start,
    cancel,
    reconnect: () => void status.refetch(),
  };
}
