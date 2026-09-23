import { describe, expect, test } from "bun:test";

import {
  SYNC_MESSAGES,
  failedStepsSummary,
  syncMessageIsHonest,
  syncFailureReason,
} from "../src/lib/sync-messages.ts";
import type { SyncJobStatus } from "../src/types/index.ts";

/**
 * Characterization dei messaggi del flusso sync: ogni aspettativa qui sotto è
 * il testo **esatto** mostrato oggi all'utente (census: le 10 notifiche di
 * `useSyncJob.ts`, più le frasi che ne compongono le descrizioni). Il file è
 * nato prima dello spostamento della logica: se un movimento tocca una
 * virgola, questo test cade.
 */
function job(overrides: Partial<SyncJobStatus> = {}): SyncJobStatus {
  return {
    job_id: "12345678-9abc-def0-1234-56789abcdef0",
    status: "completed",
    in_flight: false,
    total_steps: 10,
    completed_steps: 10,
    message: "Sync completed",
    error: null,
    failed_steps: 0,
    empty_steps: 0,
    skipped_steps: 0,
    ...overrides,
  };
}

describe("notifiche del flusso sync", () => {
  test("servizio locale muto: il testo dice quello che sappiamo, non incolpa la pagina", () => {
    expect(SYNC_MESSAGES.statusUnavailable.title).toBe("Could not load sync status");
    expect(SYNC_MESSAGES.statusUnavailable.description).toBe(
      "The local data service is not responding. If the app was just opened, give it a few seconds.",
    );
  });

  test("connessione persa durante il job", () => {
    expect(SYNC_MESSAGES.connectionLost.title).toBe("Connection lost");
    expect(SYNC_MESSAGES.connectionLost.description).toBe(
      "Could not reach the sync service. Reconnect to check the job.",
    );
  });

  test("cancellazione: nessun linguaggio di guasto, e i passi fatti si dichiarano", () => {
    expect(SYNC_MESSAGES.cancelled.title).toBe("Sync cancelled");
    expect(SYNC_MESSAGES.cancelled.description(job({ status: "cancelled", completed_steps: 4 }))).toBe(
      "4 of 10 steps had already completed and are kept.",
    );
  });

  test("sync completata con dei passi falliti: la causa la porta il job", () => {
    expect(SYNC_MESSAGES.partlyCompleted.title).toBe("Sync partly completed");
    expect(SYNC_MESSAGES.partlyCompleted.description(job({ failed_steps: 3 }))).toBe(
      "3 of 10 steps failed. Retry the download to fill the gaps.",
    );
  });

  test("sync completata senza intoppi", () => {
    expect(SYNC_MESSAGES.completed.title).toBe("Sync completed");
    expect(SYNC_MESSAGES.completed.description).toBe("The dashboard is up to date.");
  });

  test("job fallito: il motivo è quello che riporta il job", () => {
    expect(SYNC_MESSAGES.failed.title).toBe("Sync failed");
    expect(SYNC_MESSAGES.failed.description(job({ status: "failed", error: "Terna answered 503" }))).toBe(
      "Terna answered 503",
    );
  });

  test("avvio: l'id mostrato è accorciato a otto caratteri", () => {
    expect(SYNC_MESSAGES.started.title).toBe("Sync started");
    expect(SYNC_MESSAGES.started.description("12345678-9abc-def0-1234-56789abcdef0")).toBe(
      "Job 12345678 queued",
    );
  });

  test("avvio fallito", () => {
    expect(SYNC_MESSAGES.failedToStart.title).toBe("Sync failed to start");
  });

  test("cancellare un job non ferma quello che il server ha già in coda", () => {
    expect(SYNC_MESSAGES.anotherRunning.title).toBe("Another sync is running");
    expect(
      SYNC_MESSAGES.anotherRunning.description(
        "12345678-9abc-def0-1234-56789abcdef0",
        "9abcdef0-1234-5678-9abc-def012345678",
      ),
    ).toBe(
      "Job 12345678 was cancelled, but job 9abcdef0 is already running — this page now follows it.",
    );
  });

  test("cancellazione non riuscita", () => {
    expect(SYNC_MESSAGES.cancelFailed.title).toBe("Could not cancel the sync");
  });
});

describe("conteggio dei passi falliti", () => {
  test("col totale noto dice quanti su quanti", () => {
    expect(failedStepsSummary(job({ failed_steps: 3, total_steps: 10 }))).toBe("3 of 10 steps failed");
  });

  test("senza totale noto conta i passi, al singolare quando è uno", () => {
    expect(failedStepsSummary(job({ failed_steps: 1, total_steps: 0 }))).toBe("1 step failed");
    expect(failedStepsSummary(job({ failed_steps: 2, total_steps: 0 }))).toBe("2 steps failed");
  });
});

describe("onestà del messaggio del job", () => {
  test("un successo dichiarato senza fallimenti si crede", () => {
    expect(syncMessageIsHonest(job({ message: "Sync completed" }))).toBe(true);
  });

  test("un successo dichiarato con dei fallimenti no", () => {
    expect(syncMessageIsHonest(job({ message: "Sync completed", failed_steps: 2 }))).toBe(false);
    expect(syncMessageIsHonest(job({ message: "  SYNC FINISHED  ", failed_steps: 2 }))).toBe(false);
    expect(syncMessageIsHonest(job({ message: "Sync succeeded", failed_steps: 2 }))).toBe(false);
  });

  test("un messaggio che non afferma un successo resta credibile", () => {
    expect(syncMessageIsHonest(job({ message: "Partial: 2 datasets unavailable", failed_steps: 2 }))).toBe(true);
  });
});

describe("motivo del fallimento", () => {
  test("l'errore del server vince su tutto", () => {
    expect(
      syncFailureReason(job({ status: "failed", error: "  Terna answered 503  ", failed_steps: 2 })),
    ).toBe("Terna answered 503");
  });

  test("senza errore si usa il messaggio del job, se onesto", () => {
    expect(syncFailureReason(job({ status: "failed", message: "  Token expired  " }))).toBe("Token expired");
  });

  test("un messaggio disonesto è sostituito dai contatori", () => {
    expect(
      syncFailureReason(job({ status: "failed", message: "Sync completed", failed_steps: 2, total_steps: 10 })),
    ).toBe("2 of 10 steps failed");
  });

  test("senza errore e senza messaggio restano i contatori", () => {
    expect(syncFailureReason(job({ status: "failed", message: "", failed_steps: 1, total_steps: 0 }))).toBe(
      "1 step failed",
    );
  });
});
