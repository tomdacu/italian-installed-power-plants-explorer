/**
 * Copia la SPA compilata (`dist/`) in `static/`, la cartella che il server
 * serve (e che il pacchetto npm e l'eseguibile compilato portano con sé).
 *
 *   bun run scripts/copy-static.ts
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

import { emptyDir } from "./clean.ts";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const target = join(root, "static");

if (!existsSync(join(dist, "index.html"))) {
  console.error("Manca dist/index.html: esegui prima `bun run build`.");
  process.exit(1);
}

// Svuotare davvero: `rmSync(target, { force: true })` falliva in silenzio su
// OneDrive e i bundle vecchi restavano nel pacchetto.
const removed = emptyDir(target);
cpSync(dist, target, { recursive: true });
console.log(`static/ aggiornata da dist/ (${target}, ${removed} voci rimosse)`);
