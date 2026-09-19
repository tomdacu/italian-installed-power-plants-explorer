/**
 * Segreto OAuth2 a riposo.
 *
 * Windows: DPAPI (`CryptProtectData`) chiamato direttamente via `bun:ffi`.
 * La via "PowerShell + ProtectedData" funziona ma costa ~2,6 s per chiamata
 * (misurato): inaccettabile all'avvio. FFI costa 24 ms la prima volta, <1 ms poi.
 *
 * macOS: `security`; Linux: `secret-tool` (entrambi one-shot, fuori dall'avvio).
 */
import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";

const SERVICE = "italian-capacity-explorer";
/** Nome usato prima della rinomina: serve solo per la migrazione una tantum. */
const LEGACY_SERVICE = "terna-installed-capacity";

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

/** `LocalFree` è esportata da kernel32, non da crypt32. */
const kernel32 =
  process.platform === "win32"
    ? dlopen("kernel32.dll", { LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr } })
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
  const outPtr = Number(view.getBigUint64(8, true));
  const outLen = view.getUint32(0, true);
  // `bigint` è l'unica forma di indirizzo accettata sia da toArrayBuffer sia da
  // LocalFree: evita i cast e resta corretto a runtime.
  const address = BigInt(outPtr);
  const bytes = new Uint8Array(toArrayBuffer(address, 0, outLen)).slice();
  kernel32?.symbols.LocalFree(address);
  return bytes;
}

export function dpapiProtect(plain: string): Uint8Array {
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

export function dpapiUnprotect(sealed: Uint8Array): string {
  if (!crypt32) throw new Error("DPAPI disponibile solo su Windows");
  const input = dataBlob(sealed);
  const output = new Uint8Array(16);
  const ok = crypt32.symbols.CryptUnprotectData(ptr(input), null, null, null, null, 0x1, ptr(output));
  if (!ok) throw new Error("CryptUnprotectData failed");
  return new TextDecoder().decode(takeOutput(output));
}

async function run(command: string[]): Promise<{ code: number; stdout: string }> {
  const process_ = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(process_.stdout).text();
  return { code: await process_.exited, stdout: stdout.trim() };
}

/** Legge il segreto dal Credential Manager usato dalla versione Python (una volta). */
export async function readLegacyKeyringSecret(clientId: string): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const script =
    "[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null;" +
    `$v=New-Object Windows.Security.Credentials.PasswordVault;$c=$v.Retrieve('${LEGACY_SERVICE}','${clientId}');$c.RetrievePassword();$c.Password`;
  const { code, stdout } = await run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script]);
  return code === 0 && stdout ? stdout : null;
}

export const secretBackendName =
  process.platform === "win32" ? "DPAPI" : process.platform === "darwin" ? "Keychain" : "secret-service";

export interface SecretStore {
  save(clientId: string, secret: string): Promise<void>;
  load(clientId: string): Promise<string | null>;
  remove(clientId: string): Promise<void>;
}

export function createSecretStore(filePath: string): SecretStore {
  if (process.platform === "win32") {
    return {
      async save(_clientId, secret) {
        await Bun.write(filePath, dpapiProtect(secret));
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
        await run(["cmd", "/c", "del", "/f", "/q", filePath]);
      },
    };
  }

  if (process.platform === "darwin") {
    return {
      async save(clientId, secret) {
        await run(["security", "add-generic-password", "-a", clientId, "-s", SERVICE, "-w", secret, "-U"]);
      },
      async load(clientId) {
        const { code, stdout } = await run(["security", "find-generic-password", "-a", clientId, "-s", SERVICE, "-w"]);
        return code === 0 && stdout ? stdout : null;
      },
      async remove(clientId) {
        await run(["security", "delete-generic-password", "-a", clientId, "-s", SERVICE]);
      },
    };
  }

  return {
    async save(clientId, secret) {
      const process_ = Bun.spawn(["secret-tool", "store", "--label", SERVICE, "service", SERVICE, "account", clientId], {
        stdin: "pipe",
      });
      process_.stdin.write(secret);
      process_.stdin.end();
      await process_.exited;
    },
    async load(clientId) {
      const { code, stdout } = await run(["secret-tool", "lookup", "service", SERVICE, "account", clientId]);
      return code === 0 && stdout ? stdout : null;
    },
    async remove(clientId) {
      await run(["secret-tool", "clear", "service", SERVICE, "account", clientId]);
    },
  };
}
