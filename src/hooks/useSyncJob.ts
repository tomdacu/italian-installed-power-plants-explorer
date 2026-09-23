import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useToast } from "@/components/ui/Toast";
import type { SyncRequest } from "@/types";
import { INVALIDATE_AFTER_SYNC, queryKeys } from "@/lib/query-keys";
import { SETTLE_POLL_MS, settleWindow, type Settling } from "@/lib/sync-settling";
// I messaggi (e le frasi che li compongono) vivono in `@/lib/sync-messages`,
// puri: li difende `tests/sync-messages.test.ts` senza tirare dentro i componenti.
import { SYNC_MESSAGES } from "@/lib/sync-messages";

const ACTIVE = new Set(["queued", "running"]);

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
  const settling = useRef<Settling | null>(null);

  const latest = useQuery({
    queryKey: queryKeys.syncLatest(),
    queryFn: api.latestSyncStatus,
    refetchOnMount: "always",
    retry: false,
  });
  const jobId = startedJobId ?? latest.data?.job_id ?? null;
  const status = useQuery({
    queryKey: queryKeys.syncJob(jobId),
    queryFn: () => api.syncStatus(jobId!),
    enabled: jobId !== null,
    retry: 5,
    retryDelay: 2500,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const data = query.state.data;
      // Nessun dato: si segue. Job attivo **o passo ancora in volo** (`in_flight`
      // resta vero finché il server non chiude l'attesa del passo, anche su un
      // job già cancellato): si segue. Job finito: si smette, tranne se è quello
      // appena cancellato e i contatori non hanno ancora dato due letture
      // identiche.
      if (!data || ACTIVE.has(data.status) || data.in_flight) return SETTLE_POLL_MS;
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

  // Dopo una cancellazione si smette di interrogare il job solo quando il passo
  // in volo è finito (`in_flight` falso, quindi i contatori hanno già assorbito
  // il suo esito) e due letture consecutive dei contatori coincidono. Il tetto
  // assoluto chiude comunque, e il pannello resta su quello che ha letto.
  // Le regole stanno in `settleWindow`: qui si conserva solo la finestra.
  useEffect(() => {
    const state = settling.current;
    if (state === null || !status.data) return;
    const next = settleWindow(state, status.data, Date.now());
    if (next === state) return;
    settling.current = next;
    if (next === null) setSettlingJobId(null);
  }, [status.data, status.dataUpdatedAt]);

  useEffect(() => {
    if (latest.isError) {
      // "Try reopening Data sync" incolpava la pagina quando la causa è il
      // servizio locale spento: il testo dice quello che sappiamo davvero.
      toast.error(SYNC_MESSAGES.statusUnavailable.title, SYNC_MESSAGES.statusUnavailable.description);
    }
  }, [latest.isError, toast]);

  useEffect(() => {
    if (connectionLost) {
      toast.error(SYNC_MESSAGES.connectionLost.title, SYNC_MESSAGES.connectionLost.description);
    }
  }, [connectionLost, toast]);

  useEffect(() => {
    if (!job || running || notifiedJobId.current === job.job_id) return;
    notifiedJobId.current = job.job_id;
    if (job.status === "completed" || job.status === "cancelled") {
      // I passi già completati hanno scritto nel database: la dashboard va
      // riletta anche dopo una cancellazione.
      for (const key of INVALIDATE_AFTER_SYNC) {
        void qc.invalidateQueries({ queryKey: key });
      }
      if (startedJobId === job.job_id) {
        if (job.status === "cancelled") {
          // Cancellare non è un errore: nessun toast rosso, e nessuna
          // affermazione di successo.
          toast.info(SYNC_MESSAGES.cancelled.title, SYNC_MESSAGES.cancelled.description(job));
        } else if (job.failed_steps > 0) {
          // Mai "limiti API temporanei": la causa la riporta il job stesso.
          toast.warning(
            SYNC_MESSAGES.partlyCompleted.title,
            SYNC_MESSAGES.partlyCompleted.description(job),
          );
        } else {
          toast.success(SYNC_MESSAGES.completed.title, SYNC_MESSAGES.completed.description);
        }
      }
    } else if (startedJobId === job.job_id) {
      toast.error(SYNC_MESSAGES.failed.title, SYNC_MESSAGES.failed.description(job));
    }
  }, [job, running, startedJobId, qc, toast]);

  const start = async (request: SyncRequest): Promise<void> => {
    if (startingRef.current || busy) return;
    markStarting(true);
    try {
      const response = await api.startSync(request);
      notifiedJobId.current = null;
      setStartedJobId(response.job_id);
      toast.info(SYNC_MESSAGES.started.title, SYNC_MESSAGES.started.description(response.job_id));
      // Niente `finally`: `starting` resta vero finché lo stato del job creato
      // non risponde (l'effetto qui sopra lo abbassa). È la finestra in cui un
      // doppio click faceva partire un secondo job.
    } catch (error) {
      markStarting(false);
      toast.error(SYNC_MESSAGES.failedToStart.title, (error as Error).message);
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
        qc.setQueryData(queryKeys.syncLatest(), other);
        qc.setQueryData(queryKeys.syncJob(other.job_id), other);
        toast.info(
          SYNC_MESSAGES.anotherRunning.title,
          SYNC_MESSAGES.anotherRunning.description(cancelledId, other.job_id),
        );
        return;
      }
      // Nessun altro job: si annuncia la cancellazione (contatori finali, via
      // effetto) e si continua a leggere il job finché il passo in volo non si
      // chiude, così il conteggio mostrato è quello vero.
      notifiedJobId.current = null;
      qc.setQueryData(queryKeys.syncJob(cancelledId), updated);
      void qc.invalidateQueries({ queryKey: queryKeys.syncLatest() });
      settling.current = settleWindow(null, updated, Date.now());
      setSettlingJobId(cancelledId);
    } catch (error) {
      toast.error(SYNC_MESSAGES.cancelFailed.title, (error as Error).message);
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
