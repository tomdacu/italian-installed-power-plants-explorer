/**
 * Il log dell'istanza: `backend.log` nella cartella dati, più il ponte da
 * `console.warn`/`console.error`.
 *
 * Vive fuori da `cli.ts` perché è tutto ciò che resta scritto quando la finestra
 * è senza console: chi lo legge o lo cambia non deve passare dall'avvio.
 */
import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { inspect } from "node:util";

/** File di log dell'istanza: aperto prima di costruire l'app, così ogni errore
 * d'avvio resta scritto da qualche parte anche senza console. */
let logTarget: string | null = null;

/**
 * Righe emesse prima che il log esistesse. L'avviso sulle ACL di
 * `ensureDataDir` parla proprio della cartella che contiene il log e arriva
 * **prima** che il file sia aperto: senza questo buffer restava solo su stderr,
 * cioè invisibile a chi usa la finestra senza console. Si rilasciano in testa al
 * file appena è aperto; se il log non si apre mai, restano su stderr (l'unica
 * destinazione disponibile) e non vengono stampati due volte.
 */
const pendingLines: string[] = [];

export function openLog(path: string): void {
  // Un log che cresce all'infinito (una riga a ogni avvio) non serve a nessuno:
  // oltre il megabyte si riparte da capo.
  try {
    if (existsSync(path) && statSync(path).size > 1_000_000) writeFileSync(path, "");
  } catch {
    // se non si può ruotare, si continua ad appendere
  }
  // La prova di scrittura è la sola cosa che dice se il log è davvero aperto:
  // senza, `logTarget` restava valorizzato anche quando nessuno poteva
  // scrivere, e la riga "Dettagli in …" indicava un file inesistente.
  appendFileSync(path, "");
  // Su Windows `appendFileSync` non fallisce nemmeno contro una cartella: se il
  // target è una directory la prova deve comunque fallire, altrimenti
  // `logTarget` punterebbe a un percorso su cui non si scriverà mai nulla.
  if (!statSync(path).isFile()) throw new Error(`${path} is a directory, not a log file`);
  logTarget = path;
  // In testa al file, non in coda: sono le righe più vecchie della sessione
  // (l'avviso sulle ACL della cartella dati) e vanno lette per prime.
  if (pendingLines.length > 0) {
    const buffered = pendingLines.splice(0, pendingLines.length).join("");
    try {
      appendFileSync(path, buffered);
    } catch {
      // se non si scrive restano su stderr, dove sono già passate
    }
  }
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  // Su file **e** su console: il file serve a chi usa la finestra senza console,
  // la console a chi lancia il comando da terminale o da uno script.
  if (logTarget) {
    try {
      appendFileSync(logTarget, line);
    } catch {
      // se il log non è scrivibile resta la console
    }
  } else {
    // Log non ancora aperto: la riga aspetta in memoria di essere rilasciata.
    pendingLines.push(line);
  }
  process.stderr.write(`${message}\n`);
}

/** Una riga di console: gli argomenti non-stringa passano da `inspect`, così un
 *  Error porta con sé lo stack invece di diventare "[object Object]". */
function consoleMessage(args: unknown[]): string {
  return args.map((value) => (typeof value === "string" ? value : inspect(value))).join(" ");
}

/**
 * `console.warn` e `console.error` finiscono nel log dell'istanza. Il file
 * `backend.log` è l'unica traccia che resta quando la finestra è senza console:
 * gli avvisi emessi dalle librerie (per esempio il ripiego Linux di
 * `secrets.ts` o l'intervallo minimo fra richieste corretto da `db.ts`) devono
 * arrivare lì. Una sola destinazione: `log` scrive già su file **e** stderr,
 * quindi non c'è doppio stampo.
 */
export function installConsoleBridge(): void {
  console.warn = (...args: unknown[]) => log(`[warn] ${consoleMessage(args)}`);
  console.error = (...args: unknown[]) => log(`[error] ${consoleMessage(args)}`);
}
