import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempDirs, tempDir } from "./temp.ts";

import { appDataDir, SettingsStore } from "../server/settings.ts";


afterAll(() => {
  cleanupTempDirs();
});

const previousDataDir = process.env.TERNA_APP_DATA_DIR;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.TERNA_APP_DATA_DIR;
  else process.env.TERNA_APP_DATA_DIR = previousDataDir;
});

test("la cartella dati migra dai nomi precedenti a quello attuale", () => {
  delete process.env.TERNA_APP_DATA_DIR;
  for (const legacyName of [
    "ItalianInstalledPowerPlantsExplorer",
    "ItalianCapacityExplorer",
    "TernaInstalledCapacity",
  ]) {
    const root = tempDir("ice-root-");
    const legacy = join(root, legacyName);
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "settings.json"), '{"client_id":"vecchio"}', "utf8");

    const resolved = appDataDir(root);

    expect(resolved).toBe(join(root, "ItalianRenewableCapacityExplorer"));
    expect(existsSync(join(resolved, "settings.json"))).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  }
});

test("se esistono entrambe vince la cartella nuova", () => {
  delete process.env.TERNA_APP_DATA_DIR;
  const root = tempDir("ice-root-");
  mkdirSync(join(root, "ItalianInstalledPowerPlantsExplorer"), { recursive: true });
  mkdirSync(join(root, "ItalianRenewableCapacityExplorer"), { recursive: true });

  expect(appDataDir(root)).toBe(join(root, "ItalianRenewableCapacityExplorer"));
  expect(existsSync(join(root, "ItalianInstalledPowerPlantsExplorer"))).toBe(true);
});

test("le credenziali salvano il client id nel file e il segreto nel portachiavi", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  const dataDir = tempDir("ice-settings-");
  const store = new SettingsStore(dataDir);

  store.saveCredentials("client-abc", "segreto-di-prova");
  const payload = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")) as Record<string, unknown>;

  expect(payload.client_id).toBe("client-abc");
  expect(JSON.stringify(payload)).not.toContain("segreto-di-prova");
  expect(store.load().clientId).toBe("client-abc");
  expect(store.load().databasePath).toBe(join(dataDir, "terna_cache.sqlite"));

  process.env.TERNA_CLIENT_SECRET = "da-variabile-d-ambiente";
  expect(await store.hasCredentials()).toBe(true);

  await store.deleteCredentials();
  expect(store.load().clientId).toBeNull();
});
