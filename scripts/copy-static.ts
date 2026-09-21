/**
 * Copia la SPA compilata (`dist/`) nella cartella che il server serve.
 *
 *   bun run scripts/copy-static.ts            → static/ (pacchetto npm)
 *   bun run scripts/copy-static.ts dist-exe   → static/ accanto all'eseguibile
 *
 * L'eseguibile cerca `static/` **accanto a sé**: senza questa copia parte,
 * espone l'API e non serve l'interfaccia (e con --windows-hide-console non lo
 * dice a nessuno).
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

import { emptyDir } from "./clean.ts";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const target = resolveTarget(process.argv[2]);

if (!existsSync(join(dist, "index.html"))) {
  console.error("Manca dist/index.html: esegui prima `bun run build`.");
  process.exit(1);
}

// Svuotare davvero: `rmSync(target, { force: true })` falliva in silenzio su
// OneDrive e i bundle vecchi restavano nel pacchetto.
const removed = emptyDir(target);
cpSync(dist, target, { recursive: true });
console.log(`${target} aggiornata da dist/ (${removed} voci rimosse)`);

/** Destinazione: `static/` nel repo, oppure una cartella indicata (es. dist-exe). */
function resolveTarget(argument: string | undefined): string {
  if (!argument) return join(root, "static");
  return join(root, argument, "static");
}
