import { afterAll, afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempDirs, tempDir } from "./temp.ts";

import { appDataDir, SettingsStore } from "../server/settings.ts";


afterAll(() => {
  cleanupTempDirs();
});

const previousDataDir = process.env.TERNA_APP_DATA_DIR;
const previousClientId = process.env.TERNA_CLIENT_ID;
const previousClientSecret = process.env.TERNA_CLIENT_SECRET;

afterEach(() => {
  // Le variabili d'ambiente delle credenziali sono globali: se restano in giro,
  // ogni test successivo legge credenziali che non ha scritto lui.
  if (previousDataDir === undefined) delete process.env.TERNA_APP_DATA_DIR;
  else process.env.TERNA_APP_DATA_DIR = previousDataDir;
  if (previousClientId === undefined) delete process.env.TERNA_CLIENT_ID;
  else process.env.TERNA_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined) delete process.env.TERNA_CLIENT_SECRET;
  else process.env.TERNA_CLIENT_SECRET = previousClientSecret;
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
  delete process.env.TERNA_CLIENT_ID;
  delete process.env.TERNA_CLIENT_SECRET;
  const dataDir = tempDir("ice-settings-");
  const store = new SettingsStore(dataDir);

  await store.saveCredentials("client-abc", "segreto-di-prova");
  const payload = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")) as Record<string, unknown>;

  expect(payload.client_id).toBe("client-abc");
  expect(JSON.stringify(payload)).not.toContain("segreto-di-prova");
  expect(store.load().clientId).toBe("client-abc");
  expect(store.load().databasePath).toBe(join(dataDir, "terna_cache.sqlite"));
  expect(await store.getClientSecret()).toBe("segreto-di-prova");
  expect(await store.hasCredentials()).toBe(true);

  await store.deleteCredentials();
  expect(store.load().clientId).toBeNull();
  expect(await store.getClientSecret()).toBeNull();
  expect(await store.hasCredentials()).toBe(false);
});

test("senza variabili d'ambiente valgono le credenziali salvate", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  delete process.env.TERNA_CLIENT_ID;
  delete process.env.TERNA_CLIENT_SECRET;
  const store = new SettingsStore(tempDir("ice-settings-"));

  expect(store.load().clientId).toBeNull();
  expect(await store.hasCredentials()).toBe(false);

  await store.saveCredentials("stored-id", "stored-secret");

  expect(store.load().clientId).toBe("stored-id");
  expect(await store.getClientSecret()).toBe("stored-secret");
  expect(await store.hasCredentials()).toBe(true);
});

test("con entrambe le variabili d'ambiente vince l'ambiente", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  const store = new SettingsStore(tempDir("ice-settings-"));
  await store.saveCredentials("stored-id", "stored-secret");

  process.env.TERNA_CLIENT_ID = "env-id";
  process.env.TERNA_CLIENT_SECRET = "env-secret";

  expect(store.load().clientId).toBe("env-id");
  expect(await store.getClientSecret()).toBe("env-secret");
  expect(await store.hasCredentials()).toBe(true);
});

test("una coppia di variabili d'ambiente incompleta è ignorata, con un avviso", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  delete process.env.TERNA_CLIENT_ID;
  delete process.env.TERNA_CLIENT_SECRET;
  const store = new SettingsStore(tempDir("ice-settings-"));
  await store.saveCredentials("stored-id", "stored-secret");
  // Lettura senza variabili: azzera la memoria dell'avviso già emesso, così
  // l'asserzione qui sotto non dipende dall'ordine dei test.
  store.load();

  process.env.TERNA_CLIENT_SECRET = "env-secret";
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    // Il segreto da ambiente non ha un id da ambiente: si usano le credenziali
    // salvate, che almeno sono coerenti fra loro.
    expect(store.load().clientId).toBe("stored-id");
    expect(await store.getClientSecret()).toBe("stored-secret");
    expect(await store.hasCredentials()).toBe(true);
  } finally {
    console.warn = originalWarn;
  }

  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain("TERNA_CLIENT_ID");
  expect(warnings[0]).toContain("TERNA_CLIENT_SECRET");
});

test("l'id da ambiente non basta da solo a farsi usare", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  delete process.env.TERNA_CLIENT_ID;
  delete process.env.TERNA_CLIENT_SECRET;
  const store = new SettingsStore(tempDir("ice-settings-"));
  await store.saveCredentials("stored-id", "stored-secret");
  store.load();

  process.env.TERNA_CLIENT_ID = "env-id";

  expect(store.load().clientId).toBe("stored-id");
  expect(await store.getClientSecret()).toBe("stored-secret");
});

test("la rotazione riscrive segreto e client id insieme", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  delete process.env.TERNA_CLIENT_ID;
  delete process.env.TERNA_CLIENT_SECRET;
  const store = new SettingsStore(tempDir("ice-settings-"));

  await store.saveCredentials("client-a", "secret-a");
  await store.saveCredentials("client-b", "secret-b");

  expect(store.load().clientId).toBe("client-b");
  expect(await store.getClientSecret("client-b")).toBe("secret-b");
  expect(await store.getClientSecret()).toBe("secret-b");
});

test("se settings.json non si scrive, la rotazione non lascia un id nuovo accanto al segreto nuovo", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  delete process.env.TERNA_CLIENT_ID;
  delete process.env.TERNA_CLIENT_SECRET;
  const dataDir = tempDir("ice-settings-");
  const store = new SettingsStore(dataDir);
  await store.saveCredentials("old-client", "OLD-SECRET");

  // Su Windows `chmod 444` mette l'attributo sola-lettura: la scrittura e il
  // rename del file falliscono con EPERM e il contenuto vecchio resta leggibile.
  const settingsPath = join(dataDir, "settings.json");
  const before = readFileSync(settingsPath, "utf8");
  chmodSync(settingsPath, 0o444);
  try {
    await expect(store.saveCredentials("new-client", "NEW-SECRET")).rejects.toThrow();
  } finally {
    chmodSync(settingsPath, 0o644);
  }

  // Il file è rimasto quello di prima, byte per byte, e il segreto è stato
  // ripristinato: id e segreto appartengono ancora allo stesso client.
  expect(readFileSync(settingsPath, "utf8")).toBe(before);
  expect(store.load().clientId).toBe("old-client");
  expect(await store.getClientSecret("old-client")).toBe("OLD-SECRET");
  expect(await store.hasCredentials()).toBe(true);
  // Il temporaneo della scrittura fallita non resta sul disco.
  expect(existsSync(`${settingsPath}.tmp`)).toBe(false);
});
