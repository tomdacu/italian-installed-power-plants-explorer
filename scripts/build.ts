/**
 * Build dell'interfaccia senza mai lasciare la cartella servita a metà.
 *
 * Il vecchio `clean.ts && vite build` svuotava `dist/` **prima** di compilare: a
 * build fallita il checkout restava senza interfaccia e `GET /` rispondeva 500.
 * Qui si preparano due cartelle complete — `dist-new/` con `vite build` e
 * `static-new/` come sua copia integrale — e **solo a build riuscita** ciascuna
 * viene commutata al suo posto con un `rename` (`commitDir`). Il server serve
 * `static/` prima di `dist/` (`server/app.ts`): finché la nuova `static/` non è
 * pronta, la vecchia resta quella servita e il messaggio finale lo dice.
 *
 * A build riuscita si riscrive **solo nell'artefatto** `sw.js` la costante
 * `CACHE`, suffissandola con gli 8 caratteri iniziali dell'hash di `index.html`:
 * ogni build cambia il nome della cache e l'`activate` del service worker butta
 * i residui della precedente. Il sorgente `public/sw.js` resta con il valore
 * base.
 *
 *   bun run scripts/build.ts
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commitDir, removeDir } from "./clean.ts";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const staticDir = join(root, "static");
const stagingDist = join(root, "dist-new");
const stagingStatic = join(root, "static-new");

/** Costante presente in `public/sw.js`; si rimpiazza solo nell'artefatto. */
const SW_CACHE_CONSTANT = 'const CACHE = "ice-shell-v6"';

// 1. Compila in una cartella di appoggio: `dist/` e `static/` non vengono
//    toccate finché la build non è riuscita.
const vite = spawnSync(process.execPath, ["x", "vite", "build", "--outDir", "dist-new", "--emptyOutDir"], {
  cwd: root,
  stdio: "inherit",
});
const exitCode = vite.status ?? 1;

if (exitCode !== 0) {
  // 2. Fallita: via il parziale, `dist/` e `static/` intatte.
  discard(stagingDist, stagingStatic);
  console.error(`Build fallita: dist/ e static/ sono rimaste invariate, il server servirà ${servedDir()}.`);
  process.exit(exitCode);
}

// Una build "riuscita" senza index.html non è servibile: meglio non sostituire.
if (!existsSync(join(stagingDist, "index.html"))) {
  discard(stagingDist, stagingStatic);
  console.error(
    `vite non ha prodotto dist-new/index.html: dist/ e static/ sono rimaste invariate, il server servirà ${servedDir()}.`,
  );
  process.exit(1);
}

// 3. Bump della cache del service worker, solo nell'artefatto.
try {
  bumpServiceWorkerCache(join(stagingDist, "sw.js"), join(stagingDist, "index.html"));
} catch (error) {
  discard(stagingDist, stagingStatic);
  console.error(
    `Bump della cache del service worker non riuscito (${errorMessage(error)}): dist/ e static/ sono rimaste invariate, il server servirà ${servedDir()}.`,
  );
  process.exit(1);
}

// 4. `static-new/` è la copia integrale di `dist-new/`: si prepara **prima** di
//    toccare `static/`, così la cartella servita non può restare a metà.
try {
  removeDir(stagingStatic);
  cpSync(stagingDist, stagingStatic, { recursive: true });
} catch (error) {
  discard(stagingDist, stagingStatic);
  console.error(
    `Copia in static-new/ non riuscita (${errorMessage(error)}): dist/ e static/ sono rimaste invariate, il server servirà ${servedDir()}.`,
  );
  process.exit(1);
}

// 5. Commit di `dist/`: da qui in poi la nuova dist esiste, ma è servita solo se
//    `static/` non la copre.
try {
  commitDir(stagingDist, dist);
} catch (error) {
  discard(stagingDist, stagingStatic);
  console.error(
    `Sostituzione di dist/ non riuscita (${errorMessage(error)}): dist/ e static/ restano quelle precedenti, il server servirà ${servedDir()}.`,
  );
  process.exit(1);
}

// 6. Commit di `static/`: è la cartella che il server serve davvero.
try {
  commitDir(stagingStatic, staticDir);
} catch (error) {
  discard(stagingStatic);
  console.error(`dist/ aggiornata, ma static/ non sostituibile (${errorMessage(error)}): ${servedMessage()}`);
  process.exit(1);
}

console.log("Build completata: dist/ e static/ sostituite (rename), cache del service worker aggiornata.");

/**
 * Riscrive la costante `CACHE` nel solo artefatto `sw.js` (mai in
 * `public/sw.js`), suffissandola con gli 8 caratteri iniziali dell'hash di
 * `index.html`: ogni build bumpa il nome della cache.
 */
function bumpServiceWorkerCache(swPath: string, indexPath: string): void {
  if (!existsSync(swPath)) {
    throw new Error(`${swPath} does not exist: vite must copy public/sw.js into the build output`);
  }
  const hash = createHash("sha256").update(readFileSync(indexPath)).digest("hex").slice(0, 8);
  const source = readFileSync(swPath, "utf8");
  if (!source.includes(SW_CACHE_CONSTANT)) {
    throw new Error(`${swPath} does not contain ${SW_CACHE_CONSTANT}: the cache name cannot be bumped`);
  }
  writeFileSync(swPath, source.replace(SW_CACHE_CONSTANT, `const CACHE = "ice-shell-v6-${hash}"`));
}

/** Cartella che il server servirà adesso: `static/` vince su `dist/`. */
function servedDir(): string {
  return existsSync(join(staticDir, "index.html")) ? "static/" : "dist/";
}

/** Esito del commit finale: dice esplicitamente quale cartella resta servita. */
function servedMessage(): string {
  if (servedDir() === "static/") {
    return "static/ vecchia servita: dist/ aggiornata ma coperta da static/";
  }
  return "dist/ servita: static/ non aggiornabile";
}

/** Rimuove le cartelle di appoggio: un residuo bloccato non è fatale. */
function discard(...targets: string[]): void {
  for (const target of targets) {
    try {
      removeDir(target);
    } catch (error) {
      console.warn(`Impossibile rimuovere ${target}: ${errorMessage(error)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
