#!/usr/bin/env bun
/**
 * Entry point del comando `ice`: avvia il server locale e apre l'interfaccia.
 *
 * Tre modalità, tutte senza dipendenze native:
 *   ice                → finestra "app" del browser (senza tab né barra indirizzi)
 *   ice --browser      → browser di sistema
 *   ice --no-window    → solo server (script, test, uso da remoto)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { startApp, type LocalApp } from "./app.ts";
import { appDataDir, ensureDataDir, normalizeDataDirPath } from "./settings.ts";
import { installConsoleBridge, log, openLog } from "./log.ts";
import { parseArgs, type CliOptions } from "./cli-options.ts";

const BROWSER_CANDIDATES = [
  join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.ProgramFiles ?? "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env.ProgramFiles ?? "", "Google/Chrome/Application/chrome.exe"),
  join(process.env["ProgramFiles(x86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
];

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
  // Prima di tutto: qualunque avviso emesso da qui in avanti (avvio compreso)
  // deve poter finire nel log dell'istanza.
  installConsoleBridge();
  const options = parseArgs(Bun.argv.slice(2));

  // Una sola cartella dati per tutta l'istanza: con `--data-dir D` il log sta in
  // D come il database e le credenziali, non in una sottocartella che nessuno
  // andrebbe a cercare. Il percorso si normalizza **qui**: Git Bash/MSYS
  // consegna `/c/Users/x`, che su Windows è la radice del volume corrente, e
  // senza conversione il log finiva in un `C:\c\Users\...` mai creato
  // (`Log non creato`) mentre la cartella dati vera era altrove.
  const dataDir = normalizeDataDirPath(options.dataDir ?? appDataDir());

  // Il log va aperto **prima** di costruire l'app: un errore d'avvio (cartella
  // dati non scrivibile, database corrotto, porta occupata) spariva su stderr
  // e, con la finestra senza console, non lo vedeva nessuno.
  let logPath: string | null = null;
  try {
    ensureDataDir(dataDir);
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
  if (options.icePortInvalid) {
    // Stessa cortesia per la variabile d'ambiente: senza questa riga il log
    // diceva solo "porta occupata" facendo credere che l'unico problema fosse
    // la porta, mentre il valore dichiarato in `ICE_PORT era illeggibile.
    log(`invalid ICE_PORT value: using port ${app.port}`);
  }
  if (app.portFallback) {
    // Con la console nascosta l'avviso su stderr non lo vede nessuno: finisce
    // anche nel log.
    log(`porta ${options.port} occupata: uso ${app.port}`);
  }
  openInterface(app.url, options.window);
}


if (import.meta.main) main();
