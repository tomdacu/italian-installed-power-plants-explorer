/**
 * Impostazioni e percorsi su disco.
 * Porting di `backend/src/terna_backend/settings.py`: stessa cartella dati,
 * stessa migrazione dai nomi precedenti alla rinomina.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { createSecretStore, type SecretSnapshot, type SecretStore } from "./secrets.ts";

const APP_DIR_NAME = "ItalianRenewableCapacityExplorer";
/** Cartelle usate prima della rinomina: la migrazione le segue in ordine. */
const LEGACY_APP_DIR_NAMES = [
  "ItalianInstalledPowerPlantsExplorer",
  "ItalianCapacityExplorer",
  "TernaInstalledCapacity",
];
const SETTINGS_FILE = "settings.json";

interface SettingsPayload {
  client_id?: string;
  database_path?: string;
}

function appDataRoot(): string {
  if (platform() === "win32") return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support");
  return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
}

export function appDataDir(root: string = appDataRoot()): string {
  const override = process.env.TERNA_APP_DATA_DIR;
  if (override) return override;

  const target = join(root, APP_DIR_NAME);
  if (!existsSync(target)) {
    for (const legacyName of LEGACY_APP_DIR_NAMES) {
      const legacy = join(root, legacyName);
      if (!existsSync(legacy)) continue;
      try {
        renameSync(legacy, target); // migrazione una tantum, stessa cartella padre
      } catch {
        return legacy;
      }
      break;
    }
  }
  return target;
}

/**
 * SID dell'utente corrente, indipendente dalla lingua del sistema (`whoami /user`
 * in formato CSV: l'ultimo campo è sempre il SID). `null` se non si riesce a
 * leggerlo — in quel caso l'ACL non si tocca: senza l'utente corrente nella
 * lista dei permessi la cartella resterebbe inaccessibile a chi l'ha creata.
 * Gli eseguenti si cercano in `System32`: nel PATH può esserci il `whoami` di
 * un'altra piattaforma (Git Bash, MSYS) che non conosce `/user`.
 */
function currentUserSid(): string | null {
  try {
    const output = execFileSync(windowsTool("whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return output.match(/"(S-1-[0-9-]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Percorso assoluto di un eseguente di sistema: il PATH non è una garanzia. */
function windowsTool(name: string): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return join(root, "System32", name);
}

/**
 * Permessi della cartella dati su Windows: via l'ereditarietà (che porta dentro
 * `INTERACTIVE`, cioè qualunque utente collegato alla macchina) e permessi
 * pieni solo a utente corrente, SYSTEM e Administrators. I SID dei gruppi
 * predefiniti sono gli stessi in ogni lingua; l'utente corrente si nomina col
 * suo SID perché `DOMINIO\utente` cambia con la lingua e col tipo di account.
 */
function restrictDataDirWindows(dataDir: string): void {
  const sid = currentUserSid();
  if (!sid) {
    console.warn(`[settings] data directory permissions left unchanged: current user SID not available (${dataDir})`);
    return;
  }
  try {
    execFileSync(
      windowsTool("icacls.exe"),
      [
        dataDir,
        "/inheritance:r",
        "/grant:r", `*${sid}:(OI)(CI)F`,
        "/grant:r", "*S-1-5-18:(OI)(CI)F", // SYSTEM
        "/grant:r", "*S-1-5-32-544:(OI)(CI)F", // Administrators
      ],
      { stdio: "ignore", windowsHide: true },
    );
  } catch (error) {
    // Best effort: senza ACL restrittiva l'app funziona lo stesso, e un avviso
    // battuto nel log è meglio di una cartella dati che nessuno può più leggere.
    const detail = (error as Error)?.message ?? String(error);
    console.warn(`[settings] could not restrict permissions on the data directory (${dataDir}): ${detail}`);
  }
}

/**
 * Percorso della cartella dati nella forma che il sistema si aspetta.
 *
 * Git Bash/MSYS consegna `--data-dir /c/Users/x`: su Windows `/c` non è un
 * volume, è la radice del volume corrente, quindi la cartella finiva in
 * `C:\c\Users\x` — creata e poi cercata in un posto dove nessuno guarda. Sui
 * sistemi POSIX `/c/...` è un percorso assoluto legittimo e resta com'è: la
 * conversione vale solo per Windows. Un percorso già Windows, relativo, o che
 * comincia per `/` senza essere `/lettera` non si tocca.
 */
export function normalizeDataDirPath(dataDir: string, targetPlatform: NodeJS.Platform = platform()): string {
  if (targetPlatform !== "win32") return dataDir;
  const msys = /^\/([A-Za-z])(?:\/(.*))?$/.exec(dataDir);
  if (!msys) return dataDir;
  return `${msys[1].toUpperCase()}:/${msys[2] ?? ""}`;
}

/**
 * Crea la cartella dati con i permessi giusti **alla creazione**: su POSIX
 * `0700` (il segreto ci vive accanto), su Windows l'ACL ristretta qui sopra.
 * Se la cartella esiste già non si tocca niente: più istanze sulla stessa
 * cartella non devono litigare sui permessi di una cartella che non hanno
 * creato loro — e una cartella condivisa di proposito deve restare com'è.
 */
export function ensureDataDir(dataDir: string): void {
  const target = normalizeDataDirPath(dataDir);
  if (existsSync(target)) return;
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if (platform() === "win32") restrictDataDirWindows(target);
}

export interface AppSettings {
  dataDir: string;
  databasePath: string;
  clientId: string | null;
}

/**
 * Ultima coppia di variabili osservata: serve a non ripetere lo stesso avviso a
 * ogni lettura (le impostazioni si leggono a ogni richiesta di stato).
 */
let lastEnvPair: "absent" | "complete" | "incomplete" = "absent";

/**
 * Credenziali da variabili d'ambiente: valgono **a coppia**. Con una sola delle
 * due l'ambiente descrive una configurazione a metà — l'id nuovo con il segreto
 * salvato, o il contrario — e le due metà possono appartenere a due client
 * diversi: in quel caso si usano le credenziali salvate, che almeno sono
 * coerenti fra loro, e l'ambiente viene ignorato per intero.
 */
function envCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.TERNA_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.TERNA_CLIENT_SECRET?.trim() ?? "";
  if (!clientId && !clientSecret) {
    lastEnvPair = "absent";
    return null;
  }
  if (clientId && clientSecret) {
    lastEnvPair = "complete";
    return { clientId, clientSecret };
  }
  if (lastEnvPair !== "incomplete") {
    lastEnvPair = "incomplete";
    console.warn(
      "[settings] TERNA_CLIENT_ID and TERNA_CLIENT_SECRET must both be set: " +
        "the incomplete pair is ignored and the saved credentials are used",
    );
  }
  return null;
}

/** Scrittura atomica: un `settings.json` a metà è un file di credenziali perso. */
function writeSettings(path: string, payload: SettingsPayload): void {
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(payload, null, 2), "utf8");
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Il temporaneo non si cancella: l'errore da riportare resta quello vero,
      // ma il file abbandonato va nominato invece di sparire dal log.
      console.warn(`[settings] temporary file left behind: ${temporary}`);
    }
    throw error;
  }
}

/**
 * Credenziali e configurazione non segreta: il client id vive nel file JSON
 * (non è un segreto), il client secret nel portachiavi di sistema.
 */
export class SettingsStore {
  readonly dataDir: string;
  private readonly settingsPath: string;
  private readonly secrets: SecretStore;

  constructor(dataDir = appDataDir()) {
    // Lo store normalizza come `ensureDataDir`: con `--data-dir /c/Users/x` il
    // file delle impostazioni e il segreto finivano in `C:\c\...`, fuori dalla
    // cartella appena creata e protetta.
    this.dataDir = normalizeDataDirPath(dataDir);
    this.settingsPath = join(this.dataDir, SETTINGS_FILE);
    this.secrets = createSecretStore(join(this.dataDir, "secret.bin"));
  }

  private readPayload(): SettingsPayload {
    if (!existsSync(this.settingsPath)) return {};
    try {
      return JSON.parse(readFileSync(this.settingsPath, "utf8")) as SettingsPayload;
    } catch {
      return {};
    }
  }

  load(): AppSettings {
    ensureDataDir(this.dataDir);
    const payload = this.readPayload();
    const fromEnv = envCredentials();
    return {
      dataDir: this.dataDir,
      databasePath: payload.database_path ?? join(this.dataDir, "terna_cache.sqlite"),
      clientId: fromEnv?.clientId ?? payload.client_id ?? null,
    };
  }

  /**
   * Salva client id (file) e secret (portachiavi). L'attesa è necessaria: con
   * una scrittura "fire and forget" il controllo di stato successivo poteva
   * rispondere `configured: false` e un errore del portachiavi spariva.
   *
   * L'ordine è invertito rispetto al passato — prima il segreto, poi il file:
   * se il file non si scrive, il vecchio id resta accanto al vecchio segreto
   * (ripristinato) invece di restare accanto a un segreto nuovo che non gli
   * appartiene. In quel caso l'errore risale al chiamante: la rotta risponde
   * 500 e lo stato continua a mostrare le credenziali precedenti.
   */
  async saveCredentials(clientId: string, clientSecret: string): Promise<void> {
    ensureDataDir(this.dataDir);
    const payload = this.readPayload();
    const previousClientId = payload.client_id ?? null;
    // Il segreto vecchio si legge **prima** di scrivere quello nuovo. Senza un
    // id salvato non c'è un conto da fotografare: si usa quello che si sta per
    // scrivere, che è il solo che il rollback deve riportare a "nessun segreto".
    const previousSecret = await this.secrets.snapshot(previousClientId ?? clientId);

    await this.secrets.save(clientId, clientSecret);
    try {
      payload.client_id = clientId;
      writeSettings(this.settingsPath, payload);
    } catch (error) {
      await this.rollbackCredentials(previousClientId, clientId, previousSecret);
      throw error;
    }
  }

  /**
   * Riporta il portachiavi com'era prima della rotazione fallita. Il segreto
   * nuovo si toglie per primo: se il ripristino del vecchio fallisse, meglio
   * nessun segreto che un segreto nuovo appeso a un id vecchio.
   */
  private async rollbackCredentials(
    previousClientId: string | null,
    clientId: string,
    previous: SecretSnapshot,
  ): Promise<void> {
    if (previousClientId !== clientId) await this.secrets.remove(clientId);
    await previous.restore();
  }

  async deleteCredentials(): Promise<void> {
    const payload = this.readPayload();
    const clientId = payload.client_id;
    // Prima il segreto, poi il riferimento: se la rimozione dal portachiavi
    // fallisce non resta un client id che punta a un segreto orfano.
    if (clientId) await this.secrets.remove(clientId);
    delete payload.client_id;
    writeSettings(this.settingsPath, payload);
  }

  async getClientSecret(clientId?: string): Promise<string | null> {
    const fromEnv = envCredentials();
    if (fromEnv) return fromEnv.clientSecret;
    const resolved = clientId ?? this.load().clientId;
    if (!resolved) return null;

    // Nessun accesso alle credenziali di altre applicazioni: se il segreto non
    // è nel nostro archivio (DPAPI), l'utente lo reinserisce nella pagina
    // Credentials. Un'app che legge il portachiavi di sistema con PowerShell è
    // indistinguibile da un infostealer — e gli antivirus la trattano come tale.
    return this.secrets.load(resolved);
  }

  async hasCredentials(): Promise<boolean> {
    // La coppia completa delle variabili d'ambiente è già una configurazione
    // valida: `configured` non deve dipendere da un segreto salvato che in quel
    // caso non serve.
    if (envCredentials()) return true;
    const settings = this.load();
    if (!settings.clientId) return false;
    return (await this.getClientSecret(settings.clientId)) !== null;
  }
}
