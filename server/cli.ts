#!/usr/bin/env bun
/**
 * Entry point del comando `ice`: avvia il server locale e apre l'interfaccia.
 *
 * Tre modalità, tutte senza dipendenze native:
 *   ice                → finestra "app" del browser (senza tab né barra indirizzi)
 *   ice --browser      → browser di sistema
 *   ice --no-window    → solo server (script, test, uso da remoto)
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { startApp } from "./app.ts";
import { appDataDir } from "./settings.ts";

const BROWSER_CANDIDATES = [
  join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.ProgramFiles ?? "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.ProgramFiles ?? "", "Google/Chrome/Application/chrome.exe"),
  join(process.env["ProgramFiles(x86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
];

/** Porta stabile: l'origine della PWA installata include la porta, quindi una
 * porta casuale a ogni avvio invaliderebbe l'installazione. Se è occupata si
 * ripiega su una porta libera (in quel caso la PWA va reinstallata). */
/** Una ICE_PORT malformata non deve far esplodere l'avvio: si ricade sul default. */
const DEFAULT_PORT = (() => {
  const raw = Number(process.env.ICE_PORT ?? 8731);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 8731;
})();

interface CliOptions {
  port: number;
  window: "app" | "browser" | "none";
  dataDir?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { port: DEFAULT_PORT, window: "app" };
  for (let index = 0; index < argv.length; index += 1) {
    // `--port` senza un numero non deve mangiarsi il flag successivo.
    const arg = argv[index];
    if (arg === "--browser") options.window = "browser";
    else if (arg === "--no-window") options.window = "none";
    else if (arg === "--port") {
      // Solo un numero consuma il token successivo: `--port --no-window`
      // altrimenti si mangiava il flag e restava senza porta.
      const parsed = Number(argv[index + 1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
        options.port = parsed;
        index += 1;
      } else {
        options.port = 0;
      }
    } else if (arg === "--data-dir") {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options.dataDir = next;
        index += 1;
      }
    }
    else if (arg === "--help" || arg === "-h") {
      console.log(`Uso: ice [--browser|--no-window] [--port N] [--data-dir DIR]

  --browser     apre il browser di sistema invece della finestra app
  --no-window   avvia solo il server locale
  --port N      forza la porta (default: ${DEFAULT_PORT})
  --data-dir    cartella dati alternativa (default: %APPDATA%/ItalianRenewableCapacityExplorer)`);
      process.exit(0);
    }
  }
  return options;
}

function openInterface(url: string, mode: CliOptions["window"]): void {
  if (mode === "none") return;

  if (mode === "browser") {
    // Su macOS `xdg-open` non esiste: il browser non si apriva e lo spawn
    // faceva terminare il processo. `open` è il comando giusto lì.
    const opener =
      process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : process.platform === "darwin"
          ? ["open", url]
          : ["xdg-open", url];
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
    return;
  }

  const browser = BROWSER_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (browser) {
    // Modalità app: finestra senza chrome del browser, come una vera app desktop.
    Bun.spawn([browser, `--app=${url}`, "--window-size=1280,800"], { stdout: "ignore", stderr: "ignore" });
    return;
  }
  openInterface(url, "browser");
}

function main(): void {
  const options = parseArgs(Bun.argv.slice(2));
  const app = startApp({ port: options.port, dataDir: options.dataDir });

  const logDir = options.dataDir ?? appDataDir();
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "backend.log"), `[${new Date().toISOString()}] ice listening on ${app.url}\n`);
  } catch {
    // il log non è critico: se la cartella non è scrivibile si prosegue
  }

  console.log(`Italian Renewable Capacity Explorer in ascolto su ${app.url}`);
  console.log(`Dati in ${app.settings.load().dataDir}`);
  if (app.portFallback) {
    console.warn(`Porta preferita occupata: uso ${app.port}. La PWA installata punta alla porta stabile.`);
  }
  openInterface(app.url, options.window);

  const shutdown = () => {
    app.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) main();
