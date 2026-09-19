/**
 * Copia la SPA compilata (`dist/`) in `static/`, la cartella che il server
 * serve (e che il pacchetto npm e l'eseguibile compilato portano con sé).
 *
 *   bun run scripts/copy-static.ts
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const target = join(root, "static");

if (!existsSync(join(dist, "index.html"))) {
  console.error("Manca dist/index.html: esegui prima `bun run build`.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
console.log(`static/ aggiornata da dist/ (${target})`);
