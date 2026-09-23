/**
 * Segreto OAuth2 a riposo.
 *
 * Windows: DPAPI (`CryptProtectData`) chiamato direttamente via `bun:ffi`.
 * La via "PowerShell + ProtectedData" funziona ma costa ~2,6 s per chiamata
 * (misurato): inaccettabile all'avvio. FFI costa 24 ms la prima volta, <1 ms poi.
 *
 * macOS: `security`; Linux: `secret-tool` (entrambi one-shot, fuori dall'avvio).
 */
import { dlopen, FFIType, ptr, toArrayBuffer, type Pointer } from "bun:ffi";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";

const SERVICE = "italian-renewable-capacity-explorer";

/**
 * Scrittura atomica su file: prima il temporaneo, poi il rename. Un segreto
 * scritto a metà (o un `secret.bin` troncato da un crash) è un segreto perso:
 * il file compare completo o non compare affatto.
 */
async function writeAtomic(path: string, data: Uint8Array | string, mode?: number): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    if (mode === undefined) await Bun.write(temporary, data);
    else await Bun.write(temporary, data, { mode });
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Il temporaneo non si cancella: l'errore da riportare resta quello vero.
      // Ma il file abbandonato va nominato — senza questa riga restava sul disco
      // (magari con dentro un segreto) senza che nessuno sapesse dove guardare.
      // Nessuna cancellazione d'ufficio: chi legge il log decide cosa farne.
      console.warn(`[secrets] temporary file left behind: ${temporary}`);
    }
    throw error;
  }
}

const crypt32 =
  process.platform === "win32"
    ? dlopen("Crypt32.dll", {
        CryptProtectData: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
          returns: FFIType.bool,
        },
        CryptUnprotectData: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
          returns: FFIType.bool,
        },
      })
    : null;

/** `LocalFree` è esportata da kernel32, non da crypt32.
 *  L'indirizzo va passato come intero (`u64`), non come `ptr`: con un bigint
 *  bun:ffi lo interpreta male e la free corrompe lo heap (crash 0xC0000409). */
const kernel32 =
  process.platform === "win32"
    ? dlopen("kernel32.dll", { LocalFree: { args: [FFIType.u64], returns: FFIType.u64 } })
    : null;

/** DATA_BLOB = { DWORD cbData; BYTE *pbData; } → 16 byte su x64 (padding incluso). */
function dataBlob(bytes: Uint8Array): Uint8Array {
  const struct = new Uint8Array(16);
  const view = new DataView(struct.buffer);
  view.setUint32(0, bytes.byteLength, true);
  view.setBigUint64(8, BigInt(ptr(bytes)), true);
  return struct;
}

function takeOutput(output: Uint8Array): Uint8Array {
  const view = new DataView(output.buffer);
  const address = Number(view.getBigUint64(8, true));
  const length = view.getUint32(0, true);
  // bun:ffi dichiara toArrayBuffer come `Pointer | TypedArray | bigint`, ma a
  // runtime accetta l'indirizzo numerico scritto da CryptProtectData in DATA_BLOB
  // (è la forma verificata nello spike): il cast è solo di tipo.
  const bytes = new Uint8Array(toArrayBuffer(address as unknown as Pointer, 0, length)).slice();
  kernel32?.symbols.LocalFree(address);
  return bytes;
}

function dpapiProtect(plain: string): Uint8Array {
  if (!crypt32) throw new Error("DPAPI disponibile solo su Windows");
  const input = dataBlob(new TextEncoder().encode(plain));
  const output = new Uint8Array(16);
  const ok = crypt32.symbols.CryptProtectData(
    ptr(input),
    null,
    null,
    null,
    null,
    0x1, // CRYPTPROTECT_UI_FORBIDDEN
    ptr(output),
  );
  if (!ok) throw new Error("CryptProtectData failed");
  return takeOutput(output);
}

function dpapiUnprotect(sealed: Uint8Array): string {
  if (!crypt32) throw new Error("DPAPI disponibile solo su Windows");
  const input = dataBlob(sealed);
  const output = new Uint8Array(16);
  const ok = crypt32.symbols.CryptUnprotectData(ptr(input), null, null, null, null, 0x1, ptr(output));
  if (!ok) throw new Error("CryptUnprotectData failed");
  return new TextDecoder().decode(takeOutput(output));
}

/**
 * Esegue un comando di sistema senza mai sollevare eccezioni: su Linux il
 * portachiavi (`secret-tool`) può mancare — CI, desktop minimali — e in quel
 * caso il chiamante deve poter degradare invece di far fallire l'app.
 */
async function run(command: string[], input?: string): Promise<{ code: number; stdout: string }> {
  try {
    const process_ = Bun.spawn(command, {
      stdin: input === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    if (input !== undefined) {
      const sink = process_.stdin;
      if (!sink) throw new Error("Could not open secret-tool stdin");
      await sink.write(input);
      await sink.end();
    }
    const stdout = await new Response(process_.stdout).text();
    return { code: await process_.exited, stdout: stdout.trim() };
  } catch {
    return { code: 127, stdout: "" };
  }
}

/**
 * Stato del segreto fotografato prima di sovrascriverlo: `restore()` rimette
 * esattamente quello che c'era (i bytes su disco dove il segreto è un file, il
 * valore nel portachiavi dove è il sistema a custodirlo). Serve al rollback
 * della rotazione: se la scrittura di `settings.json` fallisce, id nuovo e
 * segreto nuovo non devono restare appaiati a metà.
 */
export interface SecretSnapshot {
  restore(): Promise<void>;
}

export interface SecretStore {
  save(clientId: string, secret: string): Promise<void>;
  load(clientId: string): Promise<string | null>;
  /**
   * Rimuove il segreto. Solleva se non ci è riuscito: cancellare il client id
   * lasciando il segreto nel portachiavi è peggio di un errore visibile.
   */
  remove(clientId: string): Promise<void>;
  snapshot(clientId: string): Promise<SecretSnapshot>;
}

export function createSecretStore(filePath: string): SecretStore {
  if (process.platform === "win32") {
    return {
      async save(_clientId, secret) {
        await writeAtomic(filePath, dpapiProtect(secret));
      },
      async load(_clientId) {
        const file = Bun.file(filePath);
        if (!(await file.exists())) return null;
        try {
          return dpapiUnprotect(new Uint8Array(await file.arrayBuffer()));
        } catch {
          return null;
        }
      },
      async remove() {
        // Niente `cmd /c del`: passava dal parsing della shell (percorso con
        // spazi) e il file restava lì. Il filesystem diretto non ha ambiguità.
        rmSync(filePath, { force: true });
        if (existsSync(filePath)) {
          throw new Error("Could not remove the stored secret from the credential file");
        }
      },
      async snapshot() {
        // I bytes cifrati sono l'unica cosa che si può rimettere identica: un
        // salva/ripristina passando da DPAPI riuscirebbe solo se il blob vecchio
        // è ancora decifrabile (e non lo sarebbe proprio nel caso in cui il
        // rollback serve).
        const previous = existsSync(filePath) ? readFileSync(filePath) : null;
        return {
          async restore() {
            if (previous) await writeAtomic(filePath, previous);
            else rmSync(filePath, { force: true });
          },
        };
      },
    };
  }

  if (process.platform === "darwin") {
    const store: SecretStore = {
      async save(clientId, secret) {
        // `security` non ha una forma documentata che legga il segreto da stdin
        // o da file: l'unica alternativa senza argv è la modalità interattiva
        // (`security -i`), che richiede di quotare il segreto in un parser a
        // comandi — con un segreto che contiene apici diventa una iniezione.
        // Quindi il segreto passa da `-w` e resta visibile in `ps` per la durata
        // della chiamata (millisecondi): compromesso dichiarato, non silenzioso.
        const { code } = await run([
          "security", "add-generic-password", "-a", clientId, "-s", SERVICE, "-w", secret, "-U",
        ]);
        if (code !== 0) throw new Error("Could not save the secret in the keychain");
      },
      async load(clientId) {
        const { code, stdout } = await run(["security", "find-generic-password", "-a", clientId, "-s", SERVICE, "-w"]);
        return code === 0 && stdout ? stdout : null;
      },
      async remove(clientId) {
        const { code, stdout } = await run(["security", "delete-generic-password", "-a", clientId, "-s", SERVICE]);
        // 44 = voce non trovata: niente da rimuovere, non è un fallimento.
        if (code !== 0 && code !== 44 && !/could not be found/i.test(stdout)) {
          throw new Error("Could not remove the stored secret from the keychain");
        }
      },
      async snapshot(clientId) {
        const previous = await store.load(clientId);
        return {
          async restore() {
            if (previous === null) await store.remove(clientId);
            else await store.save(clientId, previous);
          },
        };
      },
    };
    return store;
  }

  // Linux: `secret-tool` quando c'è (GNOME/KDE), altrimenti un file leggibile
  // solo dal proprietario, con un avviso nel log. Mai un fallimento silenzioso.
  const fallbackPath = `${filePath}.plain`;
  const unavailable = () => {
    console.warn(
      "[secrets] secret-tool non disponibile: il client secret viene salvato in un file con permessi 0600 " +
        `(${fallbackPath}). Installa libsecret per usare il portachiavi di sistema.`,
    );
  };

  const store: SecretStore = {
    async save(clientId, secret) {
      // Il segreto viaggia su **stdin** (`run` scrive nel pipe del figlio):
      // `secret-tool store` legge da lì, quindi non finisce mai in `ps`.
      const { code } = await run([
        "secret-tool",
        "store",
        "--label",
        SERVICE,
        "service",
        SERVICE,
        "account",
        clientId,
      ], secret);
      if (code === 0) return;
      unavailable();
      await writeAtomic(fallbackPath, secret, 0o600);
    },
    async load(clientId) {
      const { code, stdout } = await run(["secret-tool", "lookup", "service", SERVICE, "account", clientId]);
      if (code === 0 && stdout) return stdout;
      const file = Bun.file(fallbackPath);
      return (await file.exists()) ? (await file.text()).trim() || null : null;
    },
    async remove(clientId) {
      // `secret-tool` può mancare del tutto: in quel caso resta il file, e se
      // nemmeno quello si cancella l'errore deve arrivare al chiamante.
      await run(["secret-tool", "clear", "service", SERVICE, "account", clientId]);
      rmSync(fallbackPath, { force: true });
      if (existsSync(fallbackPath)) {
        throw new Error("Could not remove the stored secret from the fallback file");
      }
    },
    async snapshot(clientId) {
      // Qui il segreto vive nel portachiavi o nel file di ripiego: in entrambi
      // i casi rimettere il valore è rimettere lo stato.
      const previous = await store.load(clientId);
      return {
        async restore() {
          if (previous === null) await store.remove(clientId);
          else await store.save(clientId, previous);
        },
      };
    },
  };
  return store;
}
