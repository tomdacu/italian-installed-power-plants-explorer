/**
 * La finestra di quiete dopo una cancellazione: quando smettere di leggere i
 * contatori di un job che il server ha già dichiarato `cancelled`.
 *
 * INVARIANTI che questa logica soddisfa (erano inline in `useSyncJob`):
 *
 * 1. **Il passo in volo non si conta.** Finché `in_flight` è vero — il server
 *    lo tiene vero esattamente mentre l'attesa del passo è in corso — lo stato
 *    non cambia di una virgola: i contatori non hanno ancora assorbito il passo,
 *    e contarli adesso significherebbe fissare il conteggio vecchio. La finestra
 *    sopravvive quindi a un cancel in volo e resta aperta per quanto duri il
 *    passo. Allo stesso modo sopravvive ai campioni di **un altro** job: la
 *    finestra è legata all'id su cui è stata aperta, e i campioni di un id
 *    diverso non la fanno avanzare.
 * 2. **Si pota alle due estremità.** In basso: due campioni consecutivi
 *    identici dei contatori. In alto: il tetto assoluto `SETTLE_MAX_MS`, che
 *    chiude comunque — il pannello mostra quello che ha davvero letto, senza
 *    inventare una conclusione. Il tetto si controlla **prima** del conteggio
 *    dei campioni: se i contatori si muovono a ogni lettura il ramo "cambiato"
 *    uscirebbe sempre, e il tetto non verrebbe mai valutato — la lettura non
 *    finirebbe più.
 * 3. **Una finestra stabile è due letture identiche consecutive.** Il contatore
 *    dei campioni riparte da zero a ogni cambiamento: la quiete non si conta dal
 *    primo cambiamento in poi, e una finestra fissa non basta, perché un
 *    contatore può muoversi dopo che la finestra è scaduta.
 *
 * La finestra si apre **solo** su una cancellazione (`cancel` in `useSyncJob`):
 * `settleWindow(null, job, now)` è l'apertura, ed è l'unico ingresso della
 * logica insieme all'avanzamento.
 */
import type { SyncJobStatus } from "@/types";

/**
 * Ritmo e durata dell'assestamento dopo una cancellazione.
 *
 * Il server legge la cancellazione **fra un passo e l'altro**: quello in volo
 * finisce comunque, e i contatori del job si muovono ancora. Il pannello deve
 * arrivare al conteggio vero senza che l'utente ricarichi la pagina, quindi:
 *
 * 1. finché `in_flight` è vero — il server lo tiene vero esattamente mentre
 *    l'attesa del passo è in corso — si continua a leggere, **per quanto duri**
 *    quel passo (una finestra fissa di pochi secondi si chiudeva prima e il
 *    pannello restava sul conteggio vecchio);
 * 2. quando `in_flight` è falso si chiude su **due campioni consecutivi
 *    identici** dei contatori, e il contatore dei campioni riparte da zero a
 *    ogni cambiamento: una finestra fissa non basta, perché un contatore può
 *    muoversi dopo che la finestra è scaduta;
 * 3. il tetto assoluto chiude comunque l'assestamento: il pannello mostra
 *    quello che ha davvero letto, senza inventare una conclusione.
 */
export const SETTLE_POLL_MS = 1500;
const SETTLE_STABLE_SAMPLES = 2;
const SETTLE_MAX_MS = 45_000;

/** I contatori che possono muoversi ancora dopo una cancellazione. */
function counters(job: SyncJobStatus): string {
  return `${job.completed_steps}/${job.failed_steps}/${job.empty_steps}/${job.message}`;
}

/** Una finestra di quiete aperta su un job cancellato. */
export interface Settling {
  /** Il job su cui la finestra è aperta: i campioni di un altro id non contano. */
  readonly id: string;
  /** L'ultima lettura dei contatori. */
  readonly counters: string;
  /** Quante letture identiche consecutive si sono viste. */
  readonly stable: number;
  /** Quando la finestra si è aperta, per il tetto assoluto. */
  readonly startedAt: number;
}

/**
 * Unico ingresso della logica: dato lo stato della finestra e un campione del
 * job, restituisce lo stato da conservare — oppure `null` quando la finestra si
 * è chiusa. Con `state` a `null` apre una finestra nuova su `job`.
 *
 * Restituisce **lo stesso oggetto** ricevuto quando il campione non cambia
 * niente (passo in volo, altro job): chi tiene lo stato in un ref non deve
 * riscrivere per forza.
 */
export function settleWindow(state: Settling | null, job: SyncJobStatus, now: number): Settling | null {
  if (state === null) {
    return { id: job.job_id, counters: counters(job), stable: 0, startedAt: now };
  }
  if (job.job_id !== state.id) return state;
  // Il passo in volo non ha ancora mosso i contatori: contarli adesso
  // significherebbe fissare il conteggio vecchio. Si continua a leggere.
  if (job.in_flight) return state;
  // Il tetto si controlla **prima** del conteggio dei campioni: se i contatori
  // si muovono a ogni lettura, il ramo "cambiato" uscirebbe sempre e il tetto
  // non verrebbe mai valutato — la lettura non finirebbe più.
  if (now - state.startedAt >= SETTLE_MAX_MS) return null;
  const sample = counters(job);
  if (sample !== state.counters) {
    // Contatore di letture resettato: la quiete si conta solo fra due letture
    // identiche consecutive, non dal primo cambiamento in poi.
    return { id: state.id, counters: sample, stable: 0, startedAt: state.startedAt };
  }
  const stable = state.stable + 1;
  if (stable >= SETTLE_STABLE_SAMPLES) return null;
  return { id: state.id, counters: state.counters, stable, startedAt: state.startedAt };
}
