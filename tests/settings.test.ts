import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testSettings } from "./harness.ts";
import { cleanupTempDirs, tempDir } from "./temp.ts";

import { appDataDir, normalizeDataDirPath } from "../server/settings.ts";


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
  const store = testSettings("ice-settings-");
  const dataDir = store.dataDir;

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
  const store = testSettings("ice-settings-");

  expect(store.load().clientId).toBeNull();
  expect(await store.hasCredentials()).toBe(false);

  await store.saveCredentials("stored-id", "stored-secret");

  expect(store.load().clientId).toBe("stored-id");
  expect(await store.getClientSecret()).toBe("stored-secret");
  expect(await store.hasCredentials()).toBe(true);
});

test("con entrambe le variabili d'ambiente vince l'ambiente", async () => {
  delete process.env.TERNA_APP_DATA_DIR;
  const store = testSettings("ice-settings-");
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
  const store = testSettings("ice-settings-");
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
  const store = testSettings("ice-settings-");
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
  const store = testSettings("ice-settings-");

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
  const store = testSettings("ice-settings-");
  const dataDir = store.dataDir;
  await store.saveCredentials("old-client", "OLD-SECRET");

  // L'iniezione è la stessa su ogni piattaforma: `settings.json.tmp` piantato
  // come **cartella** prima della seconda scrittura. `secrets.save` (che lavora
  // sul suo `secret.bin.tmp`) riesce, poi `writeSettings` trova il temporaneo
  // occupato da una cartella e fallisce **dentro di sé**: il segreto nuovo è già
  // stato scritto quando parte il rollback, che è esattamente il caso da
  // provare. Bloccare la scrittura con i permessi, invece, non è portabile: su
  // POSIX il `chmod 555` sulla cartella faceva fallire la scrittura del segreto
  // (EACCES su `secret.bin.tmp`) *prima* di `writeSettings`, e il rollback non
  // veniva mai esercitato — il test passava per il motivo sbagliato.
  const settingsPath = join(dataDir, "settings.json");
  const before = readFileSync(settingsPath, "utf8");
  const planted = `${settingsPath}.tmp`;
  mkdirSync(planted);
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await expect(store.saveCredentials("new-client", "NEW-SECRET")).rejects.toThrow();
  } finally {
    console.warn = originalWarn;
  }

  // Il file è rimasto quello di prima, byte per byte.
  expect(readFileSync(settingsPath, "utf8")).toBe(before);
  expect(store.load().clientId).toBe("old-client");
  // Il rollback ha rimesso il segreto **vecchio** dopo aver scritto quello
  // nuovo: senza rollback qui ci sarebbe "NEW-SECRET". E il segreto si legge
  // anche senza passare l'id, cioè dal client id rimasto nel file.
  expect(await store.getClientSecret("old-client")).toBe("OLD-SECRET");
  expect(await store.getClientSecret()).toBe("OLD-SECRET");
  expect(await store.hasCredentials()).toBe(true);
  // La cartella piantata non è stata svuotata né cancellata: il temporaneo non
  // si rimuove, quindi resta nominato nel log.
  expect(statSync(planted).isDirectory()).toBe(true);
  expect(warnings.some((line) => line.includes(planted))).toBe(true);
  rmSync(planted, { recursive: true, force: true });
  // Nessun temporaneo resta sul disco: né quello delle impostazioni (rimosso
  // dal test) né quello del segreto, che il rollback non deve abbandonare.
  expect(readdirSync(dataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

test("un percorso MSYS diventa assoluto su Windows e resta com'è altrove", () => {
  // Git Bash consegna `--data-dir /c/Users/Public/zapp`: su Windows `/c` è la
  // radice del volume corrente, quindi la cartella nasceva in `C:\c\Users\...`.
  expect(normalizeDataDirPath("/c/Users/Public/zapp", "win32")).toBe("C:/Users/Public/zapp");
  expect(normalizeDataDirPath("/d/Work/dati", "win32")).toBe("D:/Work/dati");
  expect(normalizeDataDirPath("/c", "win32")).toBe("C:/");
  expect(normalizeDataDirPath("/c/", "win32")).toBe("C:/");
  // Già assoluto, relativo, o `/` non seguito da una lettera di volume: intatti.
  expect(normalizeDataDirPath("C:/Users/Public/zapp", "win32")).toBe("C:/Users/Public/zapp");
  expect(normalizeDataDirPath("dati\\locali", "win32")).toBe("dati\\locali");
  expect(normalizeDataDirPath("/tmp/ice", "win32")).toBe("/tmp/ice");
  expect(normalizeDataDirPath("/ciao/x", "win32")).toBe("/ciao/x");
  expect(normalizeDataDirPath("/cygdrive/c/Users", "win32")).toBe("/cygdrive/c/Users");
  // Su POSIX `/c/...` è un percorso assoluto legittimo.
  expect(normalizeDataDirPath("/c/Users/Public/zapp", "linux")).toBe("/c/Users/Public/zapp");
  expect(normalizeDataDirPath("/c/Users/Public/zapp", "darwin")).toBe("/c/Users/Public/zapp");
});
