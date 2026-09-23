/**
 * Lo sweep dei residui tocca SOLO le cartelle che questa suite crea.
 *
 * Il difetto che questo test difende: il glob era `entry.startsWith("ice-")`,
 * quindi ogni `bun test` cancellava in %TEMP% anche cloni di prova, istanze
 * isolate e dati di lavoro altrui (succeso più volte durante una sessione di
 * sviluppo: clone di un checkout sparito a metà installazione, data dir di un
 * server ancora in esecuzione svuotata).
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { SUITE_PREFIXES, sweepSuiteLeftovers } from "./temp.ts";

const stamp = Date.now().toString(36);
// Vittima storica del glob troppo largo: inizia per `ice-` ma non è nostra.
const foreign = join(tmpdir(), `ice-foreign-${stamp}`);
// Residuo di un run precedente della suite: il prefisso è nostro.
const stale = join(tmpdir(), `ice-api-stale-${stamp}`);
// Cartella di un altro strumento, mai `ice-`.
const unrelated = join(tmpdir(), `zapp-unrelated-${stamp}`);

for (const dir of [foreign, stale, unrelated]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dati.txt"), "x", "utf8");
}

describe("sweep dei residui temporanei", () => {
  afterAll(() => {
    for (const dir of [foreign, stale, unrelated]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("il residuo di un run della suite viene rimosso", () => {
    sweepSuiteLeftovers();
    expect(existsSync(stale)).toBe(false);
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
});
