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
 *
 * Il bump riconosce la **dichiarazione** `const CACHE = "ice-shell-v6"` anche
 * con apici singoli o doppi e spaziature diverse (vedi `SW_CACHE_PATTERN`) e ne
 * sostituisce la prima occorrenza; una citazione del marker dentro un commento
 * o dentro una stringa resta intatta.
 *
 * Limite noto dell'harness: le prove di questa build girano su uno specchio in
 * `%TEMP%` (fuori da OneDrive), mentre la build reale gira dentro OneDrive; i
 * rami d'errore che dipendono dalle ACL di OneDrive (rename rifiutato, file
 * bloccato) non sono quindi esercitati su OneDrive da qui.
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

/**
 * Dichiarazione della cache in `public/sw.js`; la regex si applica solo
 * all'artefatto. È ancorata a **inizio riga** (`m`): un `const CACHE = …`
 * citato in un commento o dentro una stringa non è la dichiarazione e non va
 * riscritto. Tollera apici singoli o doppi e spaziature diverse attorno a
 * `const`/`=`: il marker è quel testo, non quella formattazione.
 */
const SW_CACHE_PATTERN = /^const\s+CACHE\s*=\s*(["'])ice-shell-v6\1(\s*;?)/m;

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
 * `index.html`: ogni build bumpa il nome della cache. La dichiarazione si
 * riconosce con apici singoli o doppi e con spaziature diverse e si sostituisce
 * la **prima** occorrenza — la dichiarazione è una sola; se non c'è si fallisce
 * in chiaro, dicendo quale testo manca.
 */
function bumpServiceWorkerCache(swPath: string, indexPath: string): void {
  if (!existsSync(swPath)) {
    throw new Error(`${swPath} does not exist: vite must copy public/sw.js into the build output`);
  }
  const hash = createHash("sha256").update(readFileSync(indexPath)).digest("hex").slice(0, 8);
  const source = readFileSync(swPath, "utf8");
  const match = SW_CACHE_PATTERN.exec(blankCommentsAndTemplates(source));
  if (!match) {
    throw new Error(
      `${swPath} does not contain const CACHE = "ice-shell-v6" (apici singoli o doppi ammessi): the cache name cannot be bumped`,
    );
  }
  const end = match.index + match[0].length;
  // `match` viene dal testo ripulito, ma gli offset sono quelli del sorgente e
  // la dichiarazione non è mai dentro un commento: il tratto è identico.
  const declaration = source.slice(match.index, end).replace("ice-shell-v6", `ice-shell-v6-${hash}`);
  writeFileSync(swPath, source.slice(0, match.index) + declaration + source.slice(end));
}

/**
 * `source` con commenti e template literal sostituiti da spazi, **a parità di
 * lunghezza**: gli offset restano quelli del sorgente, ma un marker citato
 * dentro un commento o una stringa multilinea non può più passare per la
 * dichiarazione. Le stringhe normali (`"…"`, `'…'`) si saltano senza toccarle:
 * non possono contenere un a capo, e saltarle evita che un `//` al loro interno
 * (un URL) venga letto come un commento.
 */
function blankCommentsAndTemplates(source: string): string {
  const blanked = source.split("");
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      if (blanked[index] !== "\n") blanked[index] = " ";
    }
  };
  /** Indice subito dopo la chiusura di una stringa aperta in `from`. */
  const skipQuoted = (from: number, quote: string): number => {
    let cursor = from + 1;
    while (cursor < source.length && source[cursor] !== quote) {
      cursor += source[cursor] === "\\" ? 2 : 1;
    }
    return Math.min(cursor + 1, source.length);
  };

  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      const lineEnd = source.indexOf("\n", index);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      blank(index, stop);
      index = stop;
    } else if (pair === "/*") {
      const commentEnd = source.indexOf("*/", index + 2);
      const stop = commentEnd === -1 ? source.length : commentEnd + 2;
      blank(index, stop);
      index = stop;
    } else if (source[index] === "`") {
      const stop = skipQuoted(index, "`");
      blank(index, stop);
      index = stop;
    } else if (source[index] === '"' || source[index] === "'") {
      index = skipQuoted(index, source[index]);
    } else {
      index += 1;
    }
  }
  return blanked.join("");
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
