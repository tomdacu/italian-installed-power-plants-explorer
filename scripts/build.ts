/**
 * Build dell'interfaccia senza mai lasciare `dist/` senza bundle.
 *
 * Il vecchio `clean.ts && vite build` svuotava `dist/` **prima** di compilare:
 * a build fallita il checkout restava senza interfaccia e `GET /` rispondeva
 * 500. Qui `vite build` scrive in `dist-new/` e `dist/` viene sostituita solo a
 * build riuscita; a fallimento il parziale viene rimosso e `dist/` e `static/`
 * restano quelle di prima.
 *
 * A build riuscita si rinfresca **anche** `static/`: il server cerca `static/`
 * prima di `dist/` (`server/app.ts`), quindi una copia vecchia vincerebbe sulla
 * nuova e riavviare il comando documentato servirebbe il bundle precedente.
 *
 *   bun run scripts/build.ts
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { emptyDir } from "./clean.ts";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const staging = join(root, "dist-new");

// 1. Compila in una cartella di appoggio: `dist/` non viene toccata finché la
//    build non è riuscita.
const exitCode = run(process.execPath, ["x", "vite", "build", "--outDir", "dist-new", "--emptyOutDir"]);

if (exitCode !== 0) {
  // 2. Fallita: via il parziale, `dist/` e `static/` intatte.
  remove(staging);
  console.error("Build fallita: dist/ e static/ sono rimaste invariate.");
  process.exit(exitCode);
}

// Una build "riuscita" senza index.html non è servibile: meglio non sostituire.
if (!existsSync(join(staging, "index.html"))) {
  remove(staging);
  console.error("vite non ha prodotto dist-new/index.html: dist/ e static/ sono rimaste invariate.");
  process.exit(1);
}

// 3. Riuscita: sostituzione. `renameSync` verso una cartella esistente fallisce
//    su Windows, quindi `dist/` si svuota e si rimuove prima di rinominare.
try {
  emptyDir(dist);
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });

  try {
    renameSync(staging, dist);
  } catch (error) {
    // OneDrive/antivirus possono tenere aperto l'handle della cartella: in quel
    // caso si copiano le voci e si butta lo staging.
    console.warn(`Rinomina dist-new → dist non riuscita (${errorMessage(error)}): copio le voci.`);
    cpSync(staging, dist, { recursive: true });
    remove(staging);
  }
} catch (error) {
  remove(staging);
  console.error(`Sostituzione di dist/ non riuscita (${errorMessage(error)}): dist-new/ rimosso.`);
  process.exit(1);
}

// 4. `static/` è servita prima di `dist/`: va rinfrescata a ogni build.
const copyExitCode = run(process.execPath, ["run", "scripts/copy-static.ts"]);
if (copyExitCode !== 0) {
  console.error("dist/ aggiornata, ma la copia in static/ è fallita.");
  process.exit(copyExitCode);
}

console.log("Build completata: dist/ sostituita e static/ rinfrescata.");

/** Esegue un comando dalla radice del progetto, con output sul terminale. */
function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  return result.status ?? 1;
}

/** Cancella una cartella di appoggio: un residuo bloccato non è fatale. */
function remove(target: string): void {
  if (!existsSync(target)) return;
  try {
    emptyDir(target);
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Impossibile rimuovere ${target}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
