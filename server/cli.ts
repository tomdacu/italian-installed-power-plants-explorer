#!/usr/bin/env bun
/**
 * Entry point del comando `ice`: avvia il server locale e apre l'interfaccia.
 *
 * Tre modalità, tutte senza dipendenze native:
 *   ice                → finestra "app" del browser (senza tab né barra indirizzi)
 *   ice --browser      → browser di sistema
 *   ice --no-window    → solo server (script, test, uso da remoto)
 */
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { startApp, type LocalApp } from "./app.ts";
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

/** File di log dell'istanza: aperto prima di costruire l'app, così ogni errore
 * d'avvio resta scritto da qualche parte anche senza console. */
let logTarget: string | null = null;

function openLog(path: string): void {
  // Un log che cresce all'infinito (una riga a ogni avvio) non serve a nessuno:
  // oltre il megabyte si riparte da capo.
  try {
    if (existsSync(path) && statSync(path).size > 1_000_000) writeFileSync(path, "");
  } catch {
    // se non si può ruotare, si continua ad appendere
  }
  // La prova di scrittura è la sola cosa che dice se il log è davvero aperto:
  // senza, `logTarget` restava valorizzato anche quando nessuno poteva
  // scrivere, e la riga "Dettagli in …" indicava un file inesistente.
  appendFileSync(path, "");
  logTarget = path;
}

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  // Su file **e** su console: il file serve a chi usa la finestra senza console,
  // la console a chi lancia il comando da terminale o da uno script.
  if (logTarget) {
    try {
      appendFileSync(logTarget, line);
    } catch {
      // se il log non è scrivibile resta la console
    }
  }
  process.stderr.write(`${message}\n`);
}

interface CliOptions {
  port: number;
  window: "app" | "browser" | "none";
  dataDir?: string;
  /** `--port` was given without a usable number: the OS picks and the log says so. */
  portInvalid?: boolean;
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
        options.portInvalid = true;
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

  // Una sola cartella dati per tutta l'istanza: con `--data-dir D` il log sta in
  // D come il database e le credenziali, non in una sottocartella che nessuno
  // andrebbe a cercare.
  const dataDir = options.dataDir ?? appDataDir();

  // Il log va aperto **prima** di costruire l'app: un errore d'avvio (cartella
  // dati non scrivibile, database corrotto, porta occupata) spariva su stderr
  // e, con la finestra senza console, non lo vedeva nessuno.
  let logPath: string | null = null;
  try {
    mkdirSync(dataDir, { recursive: true });
    logPath = join(dataDir, "backend.log");
    openLog(logPath);
  } catch (error) {
    // Nessun log aperto: la riga "Dettagli in …" non deve puntare a un file
    // che non esiste, ma il motivo va detto (la console è rimasta).
    logPath = null;
    console.error(`Log non creato (${join(dataDir, "backend.log")}): ${(error as Error)?.message ?? String(error)}`);
  }

  let app: LocalApp;
  try {
    // `logger` porta la stessa funzione nel server: gli errori a runtime
    // finiscono nel log dell'istanza, non solo nella console.
    app = startApp({ port: options.port, dataDir, logger: log });
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    log(`avvio fallito (dati in ${dataDir}): ${message}`);
    console.error(`Impossibile avviare l'applicazione: ${message}`);
    console.error(logPath ? `Dettagli in ${logPath}` : "Log non disponibile: i dettagli restano su questa console.");
    process.exit(1);
  }

  log(`Italian Renewable Capacity Explorer in ascolto su ${app.url}`);
  log(`Dati in ${dataDir}`);
  if (options.portInvalid) {
    // Il ripiego sulla porta scelta dal sistema non deve essere silenzioso:
    // `--port abc` rispondeva 200 su una porta che nessuno aveva chiesto.
    log(`invalid --port value: using port ${app.port}`);
  }
  if (app.portFallback) {
    // Con la console nascosta l'avviso su stderr non lo vede nessuno: finisce
    // anche nel log.
    log(`porta ${options.port} occupata: uso ${app.port}`);
  }
  openInterface(app.url, options.window);
}


if (import.meta.main) main();
