/**
 * Copia la SPA compilata (`dist/`) nella cartella che il server serve.
 *
 *   bun run scripts/copy-static.ts                      → static/ (pacchetto npm)
 *   bun run scripts/copy-static.ts dist-exe             → static/ accanto all'eseguibile
 *   bun run scripts/copy-static.ts dist-exe dist-other  → da una sorgente qualsiasi
 *
 * L'eseguibile cerca `static/` **accanto a sé**: senza questa copia parte,
 * espone l'API e non serve l'interfaccia (e con --windows-hide-console non lo
 * dice a nessuno).
 *
 * La destinazione non viene mai svuotata prima della copia: si copia in
 * `<destinazione>-new` e solo a copia completa si commuta con un `rename`
 * (`commitDir`), così un'interruzione non lascia una `static/` parziale con un
 * `index.html` che punta ad asset mancanti.
 */
import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { commitDir, removeDir } from "./clean.ts";

const root = join(import.meta.dir, "..");
const target = resolveTarget(process.argv[2]);
const source = resolveSource(process.argv[3]);
const staging = `${target}-new`;

if (!existsSync(join(source, "index.html"))) {
  console.error(`Manca ${join(source, "index.html")}: esegui prima \`bun run build\`.`);
  process.exit(1);
}

try {
  removeDir(staging);
  cpSync(source, staging, { recursive: true });
  commitDir(staging, target);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    removeDir(staging);
  } catch (cleanupError) {
    console.warn(`Impossibile rimuovere ${staging}: ${cleanupError}`);
  }
  console.error(`${target} non aggiornata (${reason}): resta quella precedente.`);
  process.exit(1);
}

console.log(`${target} aggiornata da ${source}`);

/** Destinazione: `static/` nel repo, oppure `<cartella>/static`. */
function resolveTarget(argument: string | undefined): string {
  if (!argument) return join(root, "static");
  return resolve(root, argument, "static");
}

/** Sorgente: `dist/` nel repo, oppure la cartella indicata. */
function resolveSource(argument: string | undefined): string {
  if (!argument) return join(root, "dist");
  return resolve(root, argument);
}
