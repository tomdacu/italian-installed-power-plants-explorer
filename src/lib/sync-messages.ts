/**
 * I messaggi del flusso sync, puri e senza dipendenze: nessun import che
 * raggiunga React o i componenti.
 *
 * Sono il testo che l'utente legge (titoli e descrizioni delle dieci
 * notifiche, più le frasi che le compongono): vivono qui, non sparsi fra le
 * chiamate a `toast`, così `tests/sync-messages.test.ts` può difenderli
 * carattere per carattere — e può farlo senza tirare dentro la catena di
 * `useSyncJob`, che tocca i componenti TSX.
 */
import type { SyncJobStatus } from "@/types";

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

/**
 * Le dieci notifiche del flusso sync, in un solo posto.
 *
 * Le descrizioni che dipendono dal job sono funzioni: il testo resta uno solo,
 * e la parte variabile è un argomento, non una concatenazione da ricomporre a
 * mano in ogni punto di chiamata.
 */
export const SYNC_MESSAGES = {
  /** Il servizio locale non risponde: la colpa non è della pagina. */
  statusUnavailable: {
    title: "Could not load sync status",
    description:
      "The local data service is not responding. If the app was just opened, give it a few seconds.",
  },
  /** Il job è in corso ma lo stato non si legge più. */
  connectionLost: {
    title: "Connection lost",
    description: "Could not reach the sync service. Reconnect to check the job.",
  },
  /** Cancellare non è un errore: nessun rosso, e i passi fatti si dichiarano. */
  cancelled: {
    title: "Sync cancelled",
    description: (job: SyncJobStatus) =>
      `${job.completed_steps} of ${job.total_steps} steps had already completed and are kept.`,
  },
  /** Completata con dei passi falliti: la causa la riporta il job stesso. */
  partlyCompleted: {
    title: "Sync partly completed",
    description: (job: SyncJobStatus) =>
      `${failedStepsSummary(job)}. Retry the download to fill the gaps.`,
  },
  completed: {
    title: "Sync completed",
    description: "The dashboard is up to date.",
  },
  failed: {
    title: "Sync failed",
    description: (job: SyncJobStatus) => syncFailureReason(job),
  },
  started: {
    title: "Sync started",
    description: (jobId: string) => `Job ${jobId.slice(0, 8)} queued`,
  },
  failedToStart: {
    title: "Sync failed to start",
  },
  /** Il server ha già un altro job attivo: cancellare questo non ferma quello. */
  anotherRunning: {
    title: "Another sync is running",
    description: (cancelledId: string, runningId: string) =>
      `Job ${cancelledId.slice(0, 8)} was cancelled, but job ${runningId.slice(0, 8)} is already running — this page now follows it.`,
  },
  cancelFailed: {
    title: "Could not cancel the sync",
  },
} as const;
