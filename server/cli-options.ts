/**
 * Le opzioni della riga di comando di `ice` e la sola regola di porta dell'app.
 *
 * La porta si dichiara in due modi — `ICE_PORT` nell'ambiente e `--port N` sulla
 * riga di comando — e i due percorsi portavano due copie della stessa
 * espressione. Qui la regola è una sola (`resolvePort`).
 *
 * In conflitto vince `--port`, anche quando è malformato: azzera la porta (la
 * sceglie il sistema) invece di ricadere sul default d'ambiente. `ICE_PORT`
 * resta comunque valutata per sé, così la riga di log sul valore ignorato si
 * stampa anche quando `--port` è stato dato.
 */
export interface CliOptions {
  port: number;
  window: "app" | "browser" | "none";
  dataDir?: string;
  /** `--port` was given without a usable number: the OS picks and the log says so. */
  portInvalid?: boolean;
  /** `ICE_PORT` is set to something unusable: the log says the value was ignored. */
  icePortInvalid?: boolean;
}

/** Porta stabile: l'origine della PWA installata include la porta, quindi una
 * porta casuale a ogni avvio invaliderebbe l'installazione. Se è occupata si
 * ripiega su una porta libera (in quel caso la PWA va reinstallata). */
export const DEFAULT_PORT = 8731;

/**
 * La sola regola di porta dell'app: un intero che è una porta vera. Vale sia per
 * `ICE_PORT` sia per `--port`.
 *
 * Un valore inutilizzabile non fa esplodere l'avvio: si ricade sul `fallback` e
 * `invalid` lo dichiara, perché chi chiama deve poter dire nel log che il valore
 * dichiarato è stato ignorato.
 */
export function resolvePort(raw: string | undefined, fallback: number): { port: number; invalid: boolean } {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65536
    ? { port: value, invalid: false }
    : { port: fallback, invalid: true };
}

/**
 * La porta dichiarata in `ICE_PORT`. Questa non è una seconda regola di porta:
 * è la regola dell'ambiente, cioè che una variabile assente o vuota è "non
 * impostata" e non un errore (vale il default). Una `ICE_PORT` malformata non
 * deve far esplodere l'avvio: si ricade sul default e la riga in `backend.log`
 * dice che il valore dichiarato è stato ignorato.
 */
export function envPort(env: string | undefined, fallback = DEFAULT_PORT): { port: number; invalid: boolean } {
  return env === undefined || env.trim() === "" ? { port: fallback, invalid: false } : resolvePort(env, fallback);
}

export function parseArgs(argv: string[]): CliOptions {
  const declared = envPort(process.env.ICE_PORT);
  const options: CliOptions = { port: declared.port, window: "app", icePortInvalid: declared.invalid };
  for (let index = 0; index < argv.length; index += 1) {
    // `--port` senza un numero non deve mangiarsi il flag successivo.
    const arg = argv[index];
    if (arg === "--browser") options.window = "browser";
    else if (arg === "--no-window") options.window = "none";
    else if (arg === "--port") {
      // Solo un numero consuma il token successivo: `--port --no-window`
      // altrimenti si mangiava il flag e restava senza porta.
      const resolved = resolvePort(argv[index + 1], 0);
      if (!resolved.invalid) {
        options.port = resolved.port;
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
  --port N      forza la porta (default: ${declared.port})
  --data-dir    cartella dati alternativa (default: %APPDATA%/ItalianRenewableCapacityExplorer)`);
      process.exit(0);
    }
  }
  return options;
}
