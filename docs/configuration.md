# Configuration, files and troubleshooting

## Command line

```
ice [--browser | --no-window] [--port N] [--data-dir DIR]
```

| Flag | Effect |
| --- | --- |
| *(none)* | starts the server and opens a browser window in app mode (no tabs, no address bar) |
| `--browser` | opens the default browser instead |
| `--no-window` | server only: useful for scripts, tests and headless machines |
| `--port N` | forces the port (default 8731) |
| `--data-dir DIR` | alternative data folder |
| `--help` | usage |

The port stays fixed because the origin of an installed app includes it; if the
port is busy the server picks a free one and says so in the log (an installed app
would then need reinstalling on the new origin). `GET /health` reports both facts —
`port` is the port actually bound and `port_fallback` is `true` when the server had
to move — and the *Install* card in Settings reads them to show the URL an installed
app would have to be reinstalled from.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ICE_PORT` | `8731` | same as `--port` |
| `ICE_STATIC_DIR` | `static/` next to the executable, or `dist/` in a checkout | where the built interface lives |
| `ICE_DEV_ORIGIN` | – (same-origin only) | one extra **loopback** origin whose state-changing requests are accepted, e.g. `http://localhost:1420` for `bun run dev`; needed because the Vite dev server is on another port |
| `TERNA_MIN_REQUEST_INTERVAL` | `1.2` | minimum seconds between Terna API calls (the platform allows ~1/second). The accepted range is **0 → 10 s**: a larger value is reduced to 10 with a line in the log, while a value that is not a number, or negative, falls back to the default |
| `TERNA_APP_DATA_DIR` | see below | alternative data folder |
| `TERNA_CLIENT_ID` / `TERNA_CLIENT_SECRET` | – | credentials for headless runs. They count **only as a pair**: with one of the two missing, both are ignored, the stored pair is used and the log says the env pair is incomplete |
| `TERNA_ALLOW_YEAR_SHRINK` | – | `1` disables the cache guard that refuses a shrinking replacement (see below), with a line in the log |
| `VITE_API_PROXY` | `http://127.0.0.1:8799` | read by **Vite** (`vite.config.ts`), never by the server: where the dev server proxies `/health`, `/records`, `/analytics`, `/metadata`, `/settings`, `/sync` and `/export` |
| `VITE_API_BASE_URL` | – (relative URLs) | read by **Vite** (`src/api/client.ts`): absolute API base for a shell or WebView that is not a browser page and enforces no CORS. From a browser page it breaks the app |

`ICE_DEV_ORIGIN` widens nothing but the dev loop: the value must be a loopback
origin (`127.0.0.1`, `localhost`, `[::1]`) and only that exact origin is added to
the same-origin rule. Leave it unset in normal use — then *Save*, *Test
connection*, *Remove* and the sync routes answer `403` to any page served from a
different origin.

The Terna credentials taken from the environment are inherited by every child
process — the browser window the app opens included — and any process running
with the same user rights can read them; the stored pair (DPAPI, Keychain,
`secret-tool`) is not exposed that way. The `VITE_*` variables above are read by
Vite when the dev server starts or when the interface is built; the server itself
never sees them.

The cache refuses to *shrink* a year: a snapshot holding fewer than half of the
rows already stored for that dataset and year is rejected with `refusing to
replace <year> with N of M stored rows`, because a half-failed Terna response
would otherwise delete real data. `TERNA_ALLOW_YEAR_SHRINK=1` disables that guard
(one line in the log); the alternative the message itself names is deleting
`terna_cache.sqlite` and syncing again.

## Files written at runtime

| Path (Windows) | Content |
| --- | --- |
| `%APPDATA%\ItalianRenewableCapacityExplorer\terna_cache.sqlite` | local cache — delete it to force a full re-sync |
| `%APPDATA%\ItalianRenewableCapacityExplorer\settings.json` | non-secret settings (client id, database path) |
| `%APPDATA%\ItalianRenewableCapacityExplorer\secret.bin` | client secret, encrypted with DPAPI |
| `%APPDATA%\ItalianRenewableCapacityExplorer\backend.log` | startup log |

On macOS the data folder is `~/Library/Application Support/ItalianRenewableCapacityExplorer`,
on Linux `~/.local/share/ItalianRenewableCapacityExplorer`. There the secret goes to the
Keychain (macOS) or to `secret-tool` (Linux) and, when `secret-tool` is unavailable,
to a `secret.bin.plain` file with `0600` permissions and a warning in the log. On
Linux the secret travels on `secret-tool`'s **stdin**, so it never shows up in the
process list; on macOS it is passed to `security add-generic-password -w`, which has
no documented stdin or file form (the interactive `security -i` would mean quoting
the secret into a command parser), so for the duration of that call — milliseconds —
it is visible to other processes that list command lines (`ps`). That is a declared
compromise, not a silent one: the code says so where the call is made.

## Development

```bash
bun install
bun run serve            # server + browser window on :8731
bun run dev              # Vite dev server on :1420 with hot reload
bun run serve --no-window --port 8799   # server only, for the Vite proxy
bun test                 # 114 tests, no network or credentials required
bun run typecheck        # interface + server
bun run build            # production bundle: dist/, and static/ refreshed with it
```

In development the Vite server proxies `/health`, `/records`, `/analytics`,
`/metadata`, `/settings`, `/sync` and `/export` to `http://127.0.0.1:8799`
(override with `VITE_API_PROXY`), so the interface always uses relative URLs.

The page keeps coming from `http://localhost:1420` while the API is on `:8799`:
reads are proxied, but every state-changing request (*Save*, *Test connection*,
*Remove*, the sync routes) carries that other origin and is rejected with `403
cross-origin request rejected`. Start the server with `ICE_DEV_ORIGIN` set to the
dev server's origin to have it accepted — `ICE_DEV_ORIGIN=http://localhost:1420`
on macOS and Linux, `set ICE_DEV_ORIGIN=http://localhost:1420 && bun run serve
--no-window --port 8799` on Windows. Without it (the normal case for the
installed app) only the server's own origin may mutate anything.

Where the server looks for the built interface, in order: `ICE_STATIC_DIR`, then
`static/` next to the executable, then `static/` next to `server/`, then `dist/`.
In a checkout that order matters, because `static/` wins over `dist/`, so the two
have to carry the same bundle. `bun run build` — and `bun run prepack`, which is
the same command and is also what `bun run compile` runs — never leaves either
folder half-written:

- the new bundle is compiled into `dist-new/`; `dist/` is touched only once the
  build succeeded and produced an `index.html`;
- a complete copy is staged in `static-new/`, and each folder takes its place
  with a rename **after** it is complete — the old `static/` is removed only when
  the new one is ready;
- on every successful build the service-worker cache name in `dist/sw.js` is
  bumped (`ice-shell-v6-<8 hex>`), so an installed app drops the previous shell
  instead of serving it from its cache;
- if any step fails, the staged copies are deleted and the message names the
  folder the server will keep serving: the old `static/` when `dist/` was already
  updated, or `dist/` when `static/` could not be updated.

So a failed build never leaves `static/` holding an `index.html` that points at
assets which do not exist, and it never lets the older of the two folders win
silently. `bun run dev` needs no build at all: Vite serves the source.

A standalone executable for your own machine, if you want one:

```bash
bun run compile          # dist-exe/ice.exe plus static/ — needs both to run
```

## Releasing

`.github/workflows/release.yml` and `.github/workflows/publish.yml` both fire on
a `v*` tag (and by hand from *Actions*), so a release is: bump, write the notes,
tag. Checklist:

1. **Version.** `package.json` `version` is the single source of truth. The tag
   must be `v<version>` — `publish.yml` refuses to publish when `GITHUB_REF_NAME`
   does not match it — and the first heading of
   [`.github/release-notes.md`](../.github/release-notes.md) must read
   `## Version <version>`, which is what `release.yml` checks before drafting the
   release (the comparison folds case and trims spaces, so `## version 1.1.0`
   passes too). Both failures name the two values, so they are one line of fix
   rather than a guessing game.
2. **The notes.** Rewrite the version heading and the *What's new* section of
   `.github/release-notes.md`: that file is the release body (`body_path`), and
   GitHub appends its automatic notes — merged PRs, commits — after it.
3. **The npm token.** The repository secret `NPM_TOKEN` must hold an npm
   **automation token** with publish rights. A token that still answers a 2FA
   prompt cannot be published from here: `npm publish` runs unattended on a
   runner and nobody can type the one-time password (EOTP), so the run dies at
   the registry with an authentication error. Automation tokens are exempt from
   that prompt — that is what they are for. `publish.yml` fails with an explicit
   `::error::` when the secret is empty, instead of finishing green without
   publishing anything; the provenance attestation needs no further secret
   (`id-token: write` is already in the workflow).
4. **Tag and push.** `git tag v1.1.0 && git push origin v1.1.0`. A tag that was
   never pushed triggers nothing.
5. **The assets.** The release must carry the **zip**
   `Italian-Renewable-Capacity-Explorer-<version>-win-x64.zip` (executable +
   `static/`) and `SHA256SUMS.txt` with its SHA-256. The bare `ice.exe` is an
   internal job artifact, never a release asset: on its own, without the
   `static/` next to it, it answers `500`. `release.yml` starts the built
   executable and asks it for `/health` and `/` before packaging it, so a broken
   bundle stops the release instead of reaching a download page.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| “Interfaccia non trovata: manca la cartella static/” | the executable was copied without `static/`; keep them together or set `ICE_STATIC_DIR` |
| The window is a plain browser tab | the browser was not detected for app mode: use your browser's *Install app*, or run with `--browser` |
| `porta 8731 occupata: uso 64335` (the digits vary) | another instance holds 8731: the server picked a free port, wrote it to `backend.log`, and `GET /health` answers `port_fallback: true`. Close the other instance and restart to get 8731 back; an installed app would need reinstalling on the new origin |
| Sync reports skipped steps | Those years are either outside 2000 → the current year or not published for the selected datasets (the national series starts in 2021): nothing to download, `skipped_steps` counts them |
| Sync reports failed steps | Terna refused the calls (quota: `403 Developer Over Rate`, or the network). They are retried with backoff; re-run the sync later, stored rows are upserted and nothing is duplicated |
| Sync reports many empty steps | years or combinations the API does not publish |
| Sync fails with `refusing to replace <year> with N of M stored rows` | a Terna response came back much smaller than what is stored for that year, so the cache refuses to overwrite good rows with a half-failed snapshot. Re-run the sync; if the smaller snapshot is really the right one, set `TERNA_ALLOW_YEAR_SHRINK=1` or delete `terna_cache.sqlite` |
| A job ends as `cancelled` | you pressed *Cancel*: the step in flight was allowed to finish and the following ones were not run. Nothing is lost — stored rows are upserted, so restarting the sync continues from where it stopped |
| Charts show nothing for a dataset | that dataset was never downloaded: run a sync covering its years |
| “The local data service is not responding” | the server is still starting, or the port changed: check the log file listed above |
