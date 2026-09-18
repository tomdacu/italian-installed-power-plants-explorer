# Terna Installed Capacity Backend

This is the backend contract for the future installable desktop application.

The app uses only the Terna Developer API. Because the code is intended to be public on GitHub, the application must never ship a shared Terna `client_secret`. Each user must create their own Terna Developer application and enter their credentials in the desktop app.

Official Terna docs used for this backend:

- Access token: <https://developer.terna.it/docs/read/Access_Token>
- Renewable Source Capacity: <https://developer.terna.it/docs/read/apis_catalog/generation/Renewable_Source_Capacity>
- Generation Plants: <https://developer.terna.it/docs/read/apis_catalog/generation/Generation_Plants>
- Installed Capacity: <https://developer.terna.it/docs/read/apis_catalog/generation/Installed_Capacity>
- Thermoelectric Capacity: <https://developer.terna.it/docs/read/apis_catalog/generation/Thermoelectric_Capacity>

## Chosen Stack

- Desktop shell: Tauri v2
- Frontend: React + TypeScript + Vite, implemented separately
- Backend: Python + FastAPI, packaged as a Tauri sidecar
- Local cache/database: SQLite via Python stdlib
- HTTP client: httpx
- Secrets: OS keychain via keyring, with environment variable fallback for development
- Tests: pytest with mocked Terna client, no live credentials required

SQLite is intentionally chosen over DuckDB for v1 because the Terna API data volume is small, SQLite is built into Python, and it simplifies cross-platform packaging. If the dataset grows substantially later, the storage layer is isolated and can be migrated.

## Data Scope

This backend exposes aggregate Terna API data, not individual plant registry rows.

Supported datasets:

- `renewable_source_capacity`: renewable installed capacity by year, region, province, source and capacity type.
- `generation_plants`: generation plant aggregate endpoint by year, region, province, source and capacity type.
- `installed_capacity`: national installed capacity by year and Terna type.
- `thermoelectric_capacity`: thermoelectric capacity by category/subcategory.

Expected user-facing filters:

- Year range
- Dataset
- Region
- Province
- Source/type
- Capacity type: `Lorda` or `Netta`
- Category/subcategory where available
- Geography level: national, region, province

## Analytics semantics

- One capacity index at a time: `summary` latest-totals default to `Lorda`
  (`capacity_type_applied`) and never sum Lorda+Netta.
- Stock, not sums: totals and `latest_only` aggregations refer to the latest
  year in the selection; multi-year views use per-year series or YoY deltas.
- `timeseries` accepts compound `group_by` (e.g. `year,source`).
- Terna returns empty bodies (not errors) for invalid values or unpublished
  years: the client maps them to zero-row steps (`empty_steps` in job status).
- `/installed-capacity` serves only the current year plus the previous six,
  national scope, GW values.

## Run Locally

From the repository root:

```powershell
python -B -m uvicorn backend.src.terna_backend.api:app --reload --port 8765
```

Do not commit credentials. For development you may set:

```powershell
$env:TERNA_CLIENT_ID="..."
$env:TERNA_CLIENT_SECRET="..."
```

## Test

```powershell
python -B -m pytest backend/tests -p no:cacheprovider
```

## Packaging Direction

The backend should be packaged with PyInstaller into a single sidecar executable per OS:

- `backend-windows.exe`
- `backend-macos`
- `backend-linux`

The Tauri app starts the sidecar on a random local port or on the fixed dev port `8765`.

