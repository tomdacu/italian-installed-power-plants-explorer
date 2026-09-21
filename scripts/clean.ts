/**
 * Svuota una cartella di build.
 *
 * `fs.rmSync(cartella, { recursive: true, force: true })` fallisce in silenzio
 * su certi filesystem (cartelle OneDrive, permessi Windows) e `force` nasconde
 * l'errore: su questa macchina `dist/` e `static/` accumulavano i bundle di ogni
 * build, che finivano poi nel pacchetto pubblicato. Cancellare le singole voci
 * funziona sempre, quindi si passa da lì.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

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

if (import.meta.main) {
  const target = process.argv[2] ?? join(import.meta.dir, "..", "dist");
  const removed = emptyDir(target);
  console.log(`${target}: ${removed} entries removed`);
}
