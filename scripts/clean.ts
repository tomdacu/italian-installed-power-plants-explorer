/**
 * Primitive di filesystem per gli script di build.
 *
 * `fs.rmSync(cartella, { recursive: true, force: true })` fallisce in silenzio
 * su certi filesystem (cartelle OneDrive, permessi Windows) e `force` nasconde
 * l'errore: su questa macchina `dist/` e `static/` accumulavano i bundle di ogni
 * build, che finivano poi nel pacchetto pubblicato. Cancellare le singole voci
 * funziona sempre, quindi si passa da lì.
 *
 * `commitDir` è l'unico modo con cui gli script mettono una cartella al suo
 * posto: la nuova si prepara altrove e si commuta con un `rename`, così una
 * copia interrotta non può mai lasciare la cartella servita a metà.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** Svuota `target` voce per voce. Lancia se una voce non si cancella. */
export function emptyDir(target: string): number {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
    return 0;
  }

  let removed = 0;
  for (const entry of readdirSync(target)) {
    const path = join(target, entry);
    const isDirectory = statSync(path).isDirectory();
    try {
      rmSync(path, { recursive: isDirectory, force: true });
    } catch {
      // Ultima spiaggia: se una voce non si cancella, meglio saperlo che
      // ritrovarsela nel pacchetto.
      throw new Error(`Could not remove ${path}`);
    }
    removed += 1;
  }
  return removed;
}

/** Rimuove `target` per intero. A differenza di `emptyDir` non ripristina nulla. */
export function removeDir(target: string): void {
  if (!existsSync(target)) return;
  emptyDir(target);
  rmSync(target, { recursive: true, force: true });
}

/**
 * Sostituisce `target` con `staging`, già completa.
 *
 * L'ordine non lascia mai `target` a metà:
 * 1. la vecchia cartella si sposta da parte (`<target>-old`);
 * 2. `staging` si commuta con un `rename` (atomico sullo stesso volume);
 * 3. solo ora la vecchia si cancella.
 *
 * Se il `rename` non riesce (handle aperti da OneDrive/antivirus) si copiano le
 * voci; se anche la copia fallisce si rimette a posto la vecchia e si rilancia,
 * così `target` resta quella di prima invece di sparire.
 */
export function commitDir(staging: string, target: string): void {
  if (!existsSync(staging)) {
    throw new Error(`Staging directory ${staging} does not exist`);
  }

  const previous = `${target}-old`;
  removeDir(previous);

  let movedAside = false;
  if (existsSync(target)) {
    try {
      renameSync(target, previous);
      movedAside = true;
    } catch {
      // Handle aperto sulla vecchia cartella: si svuota e si rimuove.
      removeDir(target);
    }
  }

  try {
    renameSync(staging, target);
  } catch {
    try {
      // Ultima spiaggia: il `rename` non è disponibile, si copiano le voci.
      cpSync(staging, target, { recursive: true });
      rmSync(staging, { recursive: true, force: true });
    } catch (copyError) {
      // Mai lasciare `target` senza contenuto: si ripristina la vecchia.
      try {
        removeDir(target);
        if (movedAside) renameSync(previous, target);
      } catch {
        // Ripristino impossibile: l'errore da riportare resta quello della copia.
      }
      throw copyError;
    }
  }

  // Residuo di appoggio: se resta bloccato non è fatale, `target` è già a posto.
  try {
    removeDir(previous);
  } catch {
    /* noop */
  }
}

if (import.meta.main) {
  const target = process.argv[2] ?? join(import.meta.dir, "..", "dist");
  const removed = emptyDir(target);
  console.log(`${target}: ${removed} entries removed`);
}
