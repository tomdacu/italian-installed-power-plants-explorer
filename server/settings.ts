/**
 * Impostazioni e percorsi su disco.
 * Porting di `backend/src/terna_backend/settings.py`: stessa cartella dati,
 * stessa migrazione dai nomi precedenti alla rinomina.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { createSecretStore, type SecretStore } from "./secrets.ts";

const APP_DIR_NAME = "ItalianCapacityExplorer";
const LEGACY_APP_DIR_NAME = "TernaInstalledCapacity";
export const SETTINGS_FILE = "settings.json";

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
  const legacy = join(root, LEGACY_APP_DIR_NAME);
  if (!existsSync(target) && existsSync(legacy)) {
    try {
      renameSync(legacy, target); // migrazione una tantum, stessa cartella padre
    } catch {
      return legacy;
    }
  }
  return target;
}

export interface AppSettings {
  dataDir: string;
  databasePath: string;
  clientId: string | null;
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
    this.dataDir = dataDir;
    this.settingsPath = join(dataDir, SETTINGS_FILE);
    this.secrets = createSecretStore(join(dataDir, "secret.bin"));
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
    mkdirSync(this.dataDir, { recursive: true });
    const payload = this.readPayload();
    return {
      dataDir: this.dataDir,
      databasePath: payload.database_path ?? join(this.dataDir, "terna_cache.sqlite"),
      clientId: payload.client_id ?? process.env.TERNA_CLIENT_ID ?? null,
    };
  }

  saveCredentials(clientId: string, clientSecret: string): void {
    mkdirSync(this.dataDir, { recursive: true });
    const payload = this.readPayload();
    payload.client_id = clientId;
    writeFileSync(this.settingsPath, JSON.stringify(payload, null, 2), "utf8");
    void this.secrets.save(clientId, clientSecret);
  }

  async deleteCredentials(): Promise<void> {
    const payload = this.readPayload();
    const clientId = payload.client_id;
    delete payload.client_id;
    writeFileSync(this.settingsPath, JSON.stringify(payload, null, 2), "utf8");
    if (clientId) await this.secrets.remove(clientId);
  }

  async getClientSecret(clientId?: string): Promise<string | null> {
    if (process.env.TERNA_CLIENT_SECRET) return process.env.TERNA_CLIENT_SECRET;
    const resolved = clientId ?? this.load().clientId;
    if (!resolved) return null;

    // Nessun accesso alle credenziali di altre applicazioni: se il segreto non
    // è nel nostro archivio (DPAPI), l'utente lo reinserisce nella pagina
    // Credentials. Un'app che legge il portachiavi di sistema con PowerShell è
    // indistinguibile da un infostealer — e gli antivirus la trattano come tale.
    return this.secrets.load(resolved);
  }

  async hasCredentials(): Promise<boolean> {
    const settings = this.load();
    if (!settings.clientId) return false;
    return (await this.getClientSecret(settings.clientId)) !== null;
  }
}
