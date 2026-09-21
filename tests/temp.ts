/**
 * Cartelle temporanee dei test.
 *
 * Su Windows un database SQLite in WAL tiene i file `-shm`/`-wal` mappati fino
 * alla fine del processo: la cartella non si può cancellare mentre il run è in
 * corso. Quindi ogni run **ripulisce i residui del run precedente** (quando
 * nessuno li tiene più) e prova comunque a rimuovere i propri alla fine.
 */
import { mkdtempSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
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

function sweepLeftovers(): void {
  if (swept) return;
  swept = true;
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith("ice-")) continue;
      removeDir(join(tmpdir(), entry));
    }
  } catch {
    // %TEMP% illeggibile: pazienza.
  }
}

export function tempDir(prefix: string): string {
  sweepLeftovers();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Best effort: quello che non si riesce a cancellare ora lo toglie il run dopo. */
export function cleanupTempDirs(): void {
  for (const dir of created) removeDir(dir);
}
