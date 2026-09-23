/**
 * Lo sweep dei residui temporanei tocca SOLO le cartelle morte di questa suite.
 *
 * Due difetti difesi qui, in ordine di anzianità:
 * 1. il glob era `entry.startsWith("ice-")`: ogni `bun test` cancellava in
 *    `%TEMP%` anche cloni di prova, istanze isolate e dati di lavoro altrui;
 * 2. il filtro di soli prefissi non distingue una suite **viva** da una morta:
 *    due suite simultanee si contenderebbero le stesse `ice-*`. Il marchio
 *    `owner.pid` chiude il caso — un pid che risponde vivo fa passare la dir.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { SUITE_PREFIXES, sweepSuiteLeftovers, tempDir } from "./temp.ts";

const stamp = Date.now().toString(36);
// Vittima storica del glob troppo largo: inizia per `ice-` ma non è nostra.
const foreign = join(tmpdir(), `ice-foreign-${stamp}`);
// Residuo di un run precedente della suite: il prefisso è nostro, nessun marchio.
const stale = join(tmpdir(), `ice-api-stale-${stamp}`);
// Residuo con marchio di un processo che è morto davvero.
const deadOwned = join(tmpdir(), `ice-api-dead-${stamp}`);
// Cartella di un altro strumento, mai `ice-`.
const unrelated = join(tmpdir(), `zapp-unrelated-${stamp}`);
// Residuo POSIX a sola lettura: `0o555` come la cartella dati di `ensureDataDir`.
// Creato dentro il suo test, non qui: gli sweep dei test precedenti lo
// toglierebbero di mezzo prima che qualcuno possa osservarlo.
let readOnly = "";

for (const dir of [foreign, stale, deadOwned, unrelated]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dati.txt"), "x", "utf8");
}

// Un pid certo-morto: un processo appena terminato, mai un numero indovinato
// (un pid riusato renderebbe il test falso-verde o falso-rosso).
const finished = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" });
await finished.exited;
writeFileSync(join(deadOwned, "owner.pid"), String(finished.pid));

// La nostra stessa dir live: marchio col pid di questo processo.
const liveOwned = tempDir("ice-api-live-");

describe("sweep dei residui temporanei", () => {
  afterAll(() => {
    rmSync(liveOwned, { recursive: true, force: true });
    for (const dir of [foreign, stale, deadOwned, unrelated, readOnly].filter((path) => path !== "")) {
      // La cartella a sola lettura si rimette scrivibile prima di cancellarla:
      // altrimenti il fallimento del test lascerebbe il residuo per sempre.
      try {
        chmodSync(dir, 0o700);
      } catch {
        /* già sparita o niente permessi */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("il residuo di un run della suite senza marchio viene rimosso", () => {
    sweepSuiteLeftovers();
    expect(existsSync(stale)).toBe(false);
  });

  test("un residuo il cui proprietario è morto viene rimosso", () => {
    sweepSuiteLeftovers();
    expect(existsSync(deadOwned)).toBe(false);
  });

  test("una dir di suite con proprietario vivo sopravvive allo sweep", () => {
    sweepSuiteLeftovers();
    expect(existsSync(join(liveOwned, "owner.pid"))).toBe(true);
    expect(readFileSync(join(liveOwned, "owner.pid"), "utf8")).toBe(String(process.pid));
    expect(existsSync(liveOwned)).toBe(true);
  });

  test("cartelle altrui che iniziano per ice- sopravvivono", () => {
    sweepSuiteLeftovers();
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(join(foreign, "dati.txt"))).toBe(true);
  });

  test("cartelle senza prefisso della suite intatte", () => {
    sweepSuiteLeftovers();
    expect(existsSync(join(unrelated, "dati.txt"))).toBe(true);
    expect(statSync(unrelated).isDirectory()).toBe(true);
  });

  test("ogni prefisso della suite è coperto dal filtro", () => {
    for (const prefix of SUITE_PREFIXES) {
      expect(`ice-qualcosa-${stamp}`.startsWith(prefix)).toBe(false);
      expect(`${prefix}residuo`.startsWith(prefix)).toBe(true);
    }
  });

  /**
   * Un residuo con i permessi tolti non si svuota con la sola rimozione dei
   * figli: su POSIX serve il permesso di scrittura sulla cartella. Su Windows
   * l'attributo di sola lettura non blocca `rmSync`, quindi qui il test è una
   * rete solo per POSIX — la stessa asserzione vale su entrambe le piattaforme.
   */
  test("un residuo a sola lettura viene comunque rimosso", () => {
    readOnly = join(tmpdir(), `ice-api-ro-${stamp}`);
    mkdirSync(readOnly, { recursive: true });
    // Il file si crea **prima** di togliere il permesso: dentro una cartella
    // `0o555` non si crea più niente (su POSIX).
    writeFileSync(join(readOnly, "dati.txt"), "x", "utf8");
    chmodSync(readOnly, 0o555);
    expect(statSync(readOnly).isDirectory()).toBe(true);

    sweepSuiteLeftovers();

    expect(existsSync(readOnly)).toBe(false);
  });
});
