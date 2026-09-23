import { afterEach, expect, test } from "bun:test";

import { DEFAULT_PORT, envPort, parseArgs, resolvePort } from "../server/cli-options.ts";

/**
 * `ICE_PORT` è globale: ogni test che la tocca la rimette com'era, altrimenti
 * l'ordine dei test decide l'esito di quelli che seguono.
 */
const ORIGINAL_ICE_PORT = process.env.ICE_PORT;

afterEach(() => {
  if (ORIGINAL_ICE_PORT === undefined) delete process.env.ICE_PORT;
  else process.env.ICE_PORT = ORIGINAL_ICE_PORT;
});

function withEnv(value: string | undefined): void {
  if (value === undefined) delete process.env.ICE_PORT;
  else process.env.ICE_PORT = value;
}

test("una porta dichiarata è usabile solo se è un intero in 1–65535", () => {
  expect(resolvePort("1", 0)).toEqual({ port: 1, invalid: false });
  expect(resolvePort("8080", 0)).toEqual({ port: 8080, invalid: false });
  expect(resolvePort("65535", 0)).toEqual({ port: 65535, invalid: false });
  // `1e3` è 1000: `Number` legge la notazione, la porta è un intero valido.
  expect(resolvePort("1e3", 0)).toEqual({ port: 1000, invalid: false });
});

test("fuori dall'intervallo delle porte si ricade sul default, dichiarandolo", () => {
  expect(resolvePort("0", DEFAULT_PORT)).toEqual({ port: DEFAULT_PORT, invalid: true });
  expect(resolvePort("65536", DEFAULT_PORT)).toEqual({ port: DEFAULT_PORT, invalid: true });
  expect(resolvePort("-1", DEFAULT_PORT)).toEqual({ port: DEFAULT_PORT, invalid: true });
  // Un non-intero non è una porta, anche se sta nell'intervallo.
  expect(resolvePort("8080.5", DEFAULT_PORT)).toEqual({ port: DEFAULT_PORT, invalid: true });
});

test("un valore non numerico non è fatale: default e valore dichiarato ignorato", () => {
  expect(resolvePort("abc", DEFAULT_PORT)).toEqual({ port: DEFAULT_PORT, invalid: true });
  expect(resolvePort("", DEFAULT_PORT)).toEqual({ port: DEFAULT_PORT, invalid: true });
  // `--port` in fondo agli argomenti: il token successivo non esiste.
  expect(resolvePort(undefined, 0)).toEqual({ port: 0, invalid: true });
});

test("ICE_PORT assente o vuota è 'non impostata', non un errore", () => {
  expect(DEFAULT_PORT).toBe(8731);
  expect(envPort(undefined)).toEqual({ port: DEFAULT_PORT, invalid: false });
  expect(envPort("")).toEqual({ port: DEFAULT_PORT, invalid: false });
  expect(envPort("   ")).toEqual({ port: DEFAULT_PORT, invalid: false });
});

test("ICE_PORT usabile diventa il default, una ICE_PORT illeggibile lo dichiara", () => {
  expect(envPort("8080")).toEqual({ port: 8080, invalid: false });
  expect(envPort("abc")).toEqual({ port: DEFAULT_PORT, invalid: true });
  expect(envPort("70000")).toEqual({ port: DEFAULT_PORT, invalid: true });
  expect(envPort("0")).toEqual({ port: DEFAULT_PORT, invalid: true });
});

test("senza argomenti valgono la porta dell'ambiente e la finestra app", () => {
  withEnv(undefined);
  expect(parseArgs([])).toEqual({ port: 8731, window: "app", icePortInvalid: false });

  withEnv("8080");
  expect(parseArgs([])).toEqual({ port: 8080, window: "app", icePortInvalid: false });

  // La variabile illeggibile non ferma l'avvio: la porta è il default e la riga
  // di log sull'ambiente è dovuta (`options.icePortInvalid`).
  withEnv("abc");
  expect(parseArgs([])).toEqual({ port: 8731, window: "app", icePortInvalid: true });
});

test("--browser e --no-window scelgono come si apre l'interfaccia", () => {
  withEnv(undefined);
  expect(parseArgs(["--browser"]).window).toBe("browser");
  expect(parseArgs(["--no-window"]).window).toBe("none");
  // L'ultimo flag vince: sono assegnazioni in sequenza, non un errore.
  expect(parseArgs(["--browser", "--no-window"]).window).toBe("none");
  expect(parseArgs(["--no-window", "--browser"]).window).toBe("browser");
});

test("--port vince su ICE_PORT, e senza --port vince l'ambiente", () => {
  withEnv("9000");
  expect(parseArgs(["--port", "8080"]).port).toBe(8080);
  expect(parseArgs([]).port).toBe(9000);
  // Nessun ripiego: la porta dichiarata è quella che si usa davvero.
  expect(parseArgs(["--port", "8080"]).portInvalid).toBeUndefined();
  expect(parseArgs(["--port", "8080"]).icePortInvalid).toBe(false);
});

test("un --port senza numero usabile non sceglie la porta e non mangia il flag dopo", () => {
  withEnv(undefined);

  expect(parseArgs(["--port", "abc"])).toMatchObject({ port: 0, portInvalid: true });
  expect(parseArgs(["--port", "70000"])).toMatchObject({ port: 0, portInvalid: true });
  expect(parseArgs(["--port", "0"])).toMatchObject({ port: 0, portInvalid: true });
  // `--port` in fondo: nessun token da consumare.
  expect(parseArgs(["--port"])).toMatchObject({ port: 0, portInvalid: true });

  // Il flag successivo resta un flag: con `--port --no-window` il vecchio
  // parser se lo mangiava e restava senza porta *e* senza modalità.
  expect(parseArgs(["--port", "--no-window"])).toMatchObject({ port: 0, portInvalid: true, window: "none" });
});

test("un --port malformato non fa credere che ICE_PORT fosse illeggibile", () => {
  withEnv("9000");
  const options = parseArgs(["--port", "abc"]);

  // `--port` vince anche quando è malformato (porta scelta dal sistema)…
  expect(options).toMatchObject({ port: 0, portInvalid: true });
  // …ma la variabile d'ambiente era una porta vera: nessuna riga su di lei.
  expect(options.icePortInvalid).toBe(false);
});

test("--data-dir prende la cartella successiva, non un flag", () => {
  withEnv(undefined);

  expect(parseArgs(["--data-dir", "/tmp/ice"]).dataDir).toBe("/tmp/ice");
  // `--data-dir --browser` non deve mangiarsi la modalità.
  const flagNext = parseArgs(["--data-dir", "--browser"]);
  expect(flagNext.dataDir).toBeUndefined();
  expect(flagNext.window).toBe("browser");
  expect(parseArgs(["--data-dir"]).dataDir).toBeUndefined();
});

test("gli argomenti sconosciuti vengono ignorati", () => {
  withEnv(undefined);
  expect(parseArgs(["--nope", "x"])).toEqual({ port: 8731, window: "app", icePortInvalid: false });
});
