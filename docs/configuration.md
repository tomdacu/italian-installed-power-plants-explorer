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
| `TERNA_MIN_REQUEST_INTERVAL` | `1.2` | minimum seconds between Terna API calls (the platform allows ~1/second) |
| `TERNA_APP_DATA_DIR` | see below | alternative data folder |
| `TERNA_CLIENT_ID` / `TERNA_CLIENT_SECRET` | – | credentials for headless runs, bypassing the stored ones |

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
bun test                 # 52 tests, no network or credentials required
bun run typecheck        # interface + server
bun run build            # production interface bundle into dist/
```

In development the Vite server proxies `/health`, `/records`, `/analytics`,
`/metadata`, `/settings`, `/sync` and `/export` to `http://127.0.0.1:8799`
(override with `VITE_API_PROXY`), so the interface always uses relative URLs.

A standalone executable for your own machine, if you want one:

```bash
bun run compile          # dist-exe/ice.exe plus static/ — needs both to run
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| “Interfaccia non trovata: manca la cartella static/” | the executable was copied without `static/`; keep them together or set `ICE_STATIC_DIR` |
| The window is a plain browser tab | the browser was not detected for app mode: use your browser's *Install app*, or run with `--browser` |
| “Porta preferita occupata: uso <port>” | another instance holds 8731; close it and restart |
| Sync reports skipped steps | Terna rate limiting (`429`/`403 Developer Over Qps`): they are retried, then reported as `failed_steps`; re-run the sync, stored steps are upserted |
| Sync reports many empty steps | years or combinations the API does not publish |
| Charts show nothing for a dataset | that dataset was never downloaded: run a sync covering its years |
| “The local data service is not responding” | the server is still starting, or the port changed: check the log file listed above |
