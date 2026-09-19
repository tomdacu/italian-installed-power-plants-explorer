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

const SERVICE = "italian-capacity-explorer";

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
