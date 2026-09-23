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
would then need reinstalling on the new origin).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ICE_PORT` | `8731` | same as `--port` |
| `ICE_STATIC_DIR` | `static/` next to the executable, or `dist/` in a checkout | where the built interface lives |
| `ICE_DEV_ORIGIN` | – (same-origin only) | one extra **loopback** origin whose state-changing requests are accepted, e.g. `http://localhost:1420` for `bun run dev`; needed because the Vite dev server is on another port |
| `TERNA_MIN_REQUEST_INTERVAL` | `1.2` | minimum seconds between Terna API calls (the platform allows ~1/second) |
| `TERNA_APP_DATA_DIR` | see below | alternative data folder |
| `TERNA_CLIENT_ID` / `TERNA_CLIENT_SECRET` | – | credentials for headless runs, bypassing the stored ones |

`ICE_DEV_ORIGIN` widens nothing but the dev loop: the value must be a loopback
origin (`127.0.0.1`, `localhost`, `[::1]`) and only that exact origin is added to
the same-origin rule. Leave it unset in normal use — then *Save*, *Test
connection*, *Remove* and the sync routes answer `403` to any page served from a
different origin.

## Files written at runtime

| Path (Windows) | Content |
| --- | --- |
| `%APPDATA%\ItalianRenewableCapacityExplorer\terna_cache.sqlite` | local cache — delete it to force a full re-sync |
| `%APPDATA%\ItalianRenewableCapacityExplorer\settings.json` | non-secret settings (client id, database path) |
| `%APPDATA%\ItalianRenewableCapacityExplorer\secret.bin` | client secret, encrypted with DPAPI |
| `%APPDATA%\ItalianRenewableCapacityExplorer\backend.log` | startup log |

On macOS the data folder is `~/Library/Application Support/ItalianRenewableCapacityExplorer`,
on Linux `~/.local/share/ItalianRenewableCapacityExplorer`. There the secret goes to the
Keychain or, when `secret-tool` is unavailable, to a `secret.bin.plain` file with
`0600` permissions and a warning in the log.

## Development

```bash
bun install
bun run serve            # server + browser window on :8731
bun run dev              # Vite dev server on :1420 with hot reload
bun run serve --no-window --port 8799   # server only, for the Vite proxy
bun test                 # 88 tests, no network or credentials required
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
In a checkout that order matters, because `static/` wins over `dist/`: `bun run
build` compiles into `dist/` and then refreshes `static/` with the same bundle,
so the two never disagree. `bun run prepack` (what publishing and `bun run
compile` run) is that same command. `dist/` is replaced only when the build
succeeded and produced an `index.html` — a failed build leaves `dist/` and
`static/` exactly as they were, so the server is never left without an interface.
`bun run dev` needs no build at all: Vite serves the source.

A standalone executable for your own machine, if you want one:

```bash
bun run compile          # dist-exe/ice.exe plus static/ — needs both to run
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| “Interfaccia non trovata: manca la cartella static/” | the executable was copied without `static/`; keep them together or set `ICE_STATIC_DIR` |
| The window is a plain browser tab | the browser was not detected for app mode: use your browser's *Install app*, or run with `--browser` |
| `porta 8731 occupata: uso 64335` (the digits vary) | another instance holds 8731: the server picked a free port and wrote it to `backend.log`. Close the other instance and restart to get 8731 back; an installed app would need reinstalling on the new origin |
| Sync reports skipped steps | Those years are not published for the selected datasets (the national series starts in 2021): nothing to download, `skipped_steps` counts them |
| Sync reports failed steps | Terna refused the calls (quota: `403 Developer Over Rate`, or the network). They are retried with backoff; re-run the sync later, stored rows are upserted and nothing is duplicated |
| Sync reports many empty steps | years or combinations the API does not publish |
| Charts show nothing for a dataset | that dataset was never downloaded: run a sync covering its years |
| “The local data service is not responding” | the server is still starting, or the port changed: check the log file listed above |
