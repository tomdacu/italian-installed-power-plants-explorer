/**
 * Cartelle temporanee dei test.
 *
 * Su Windows un database SQLite in WAL tiene i file `-shm`/`-wal` mappati fino
 * alla fine del processo: la cartella non si può cancellare mentre il run è in
 * corso. Quindi ogni run **ripulisce i residui dei run precedenti** (quando
 * nessuno li tiene più) e prova comunque a rimuovere i propri alla fine.
 *
 * Due garanzie, in ordine:
 * 1. lo sweep tocca **solo** i prefissi che questa suite crea (`SUITE_PREFIXES`)
 *    — mai cartelle altrui che usano `%TEMP%`;
 * 2. tocca solo ciò che è **morto**: `tempDir` scrive `owner.pid` dentro ogni
 *    cartella, e lo sweep la salta se quel processo è ancora vivo. Due suite
 *    simultanee (il caso che il vecchio glob di prefissi non copriva) si
 *    rispettano a vicenda; un run crashato lascia comunque residui rimovibili.
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Cancella una cartella voce per voce: su Windows `rmSync(recursive)` fallisce
 * sulla cartella stessa molto più spesso di quanto fallisca sui singoli file
 * (stessa cosa che succede in `scripts/clean.ts` con `dist/`).
 */
function removeDir(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  // Un residuo POSIX con i permessi ristretti (`0o555`, come la cartella dati di
  // `ensureDataDir`) non si svuota: togliere un figlio richiede il permesso di
  // scrittura **sulla cartella**, non sul file. Il chmod è best effort e su
  // Windows è un no-op: là l'attributo di sola lettura non blocca la rimozione.
  try {
    chmodSync(dir, 0o700);
  } catch {
    // niente permessi: si prova comunque, come prima
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      rmSync(path, { recursive: statSync(path).isDirectory(), force: true });
    } catch {
      // ancora in uso: lo farà il prossimo run
    }
  }
  try {
    // `rmdirSync` su una cartella ormai vuota: `rmSync` con `recursive: false`
    // risponde EISDIR, non è un modo per cancellare una directory.
    rmdirSync(dir);
  } catch {
    // ancora in uso: lo farà il prossimo run
  }
}

const created: string[] = [];
let swept = false;

/**
 * Prefissi che QUESTA suite crea con `mkdtempSync`: lo sweep tocca solo questi.
 * Con un glob `ice-` generico cancellava anche cartelle di altri processi —
 * cloni di prova, istanze isolate, dati di lavoro altrui che usano lo stesso
 * spazio `%TEMP%`. Se aggiungi un `tempDir("ice-…-")` con un prefisso nuovo,
 * elencalo qui.
 */
export const SUITE_PREFIXES = ["ice-api-", "ice-http-", "ice-root-", "ice-settings-", "ice-test-"];

/** `true` solo se il processo risponde viva; ogni dubbio conta come vivo. */
function ownerAlive(dir: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "owner.pid"), "utf8").trim();
  } catch {
    // Nessun proprietario dichiarato: residuo (crash prima della scrittura o
    // run anteriore a questo meccanismo) — lo sweep lo prende, come faceva lui.
    return false;
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = morto (lo sweep provveda); qualunque altro dubbio (permessi,
    // pid di un altro utente) = lo si lascia stare.
    return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

/** Esperto per il test: rimuove i residui morti, mai il vivo, mai il forestiero. */
export function sweepSuiteLeftovers(): void {
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!SUITE_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
      const dir = join(tmpdir(), entry);
      if (ownerAlive(dir)) continue;
      removeDir(dir);
    }
  } catch {
    // %TEMP% illeggibile: pazienza.
  }
}

function sweepLeftovers(): void {
  if (swept) return;
  swept = true;
  sweepSuiteLeftovers();
}

export function tempDir(prefix: string): string {
  sweepLeftovers();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  // Senza il marchio la cartella sarebbe "suite ma senza proprietario", cioè
  // esattamente il caso che lo sweep prende mentre è viva: se il marchio non si
  // può scrivere, meglio NON avere una cartella live senza proprietario.
  try {
    writeFileSync(join(dir, "owner.pid"), String(process.pid));
  } catch (error) {
    removeDir(dir);
    throw new Error(
      `Could not mark ${dir} as owned by this run (${(error as Error)?.message ?? String(error)}): ` +
        "another suite would be allowed to sweep it mid-run.",
    );
  }
  return dir;
}

/** Best effort: quello che non si riesce a cancellare ora lo toglie il run dopo. */
export function cleanupTempDirs(): void {
  for (const dir of created) removeDir(dir);
}
