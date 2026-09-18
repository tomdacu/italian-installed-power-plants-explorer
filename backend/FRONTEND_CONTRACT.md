# Frontend Contract

Frontend has freedom over UI/UX, charting library, navigation and visual design. The only hard requirement is to consume the backend API described here and keep interactions clear for non-technical users.

## Product Goal

Build a desktop app for non-technical users to explore installed generation capacity data from the Terna Developer API.

The app must make it easy to answer:

- How much renewable capacity is installed in Italy? (latest-year stock, single index)
- How does it change by year? (stock trend + annual additions)
- Which regions/provinces have the most capacity? (latest-year ranking)
- How does the mix change by source?
- What changes when the user switches between gross and net capacity? (Lorda/Netta toggle)

Do not expose API complexity in the main workflow. Put Terna credentials and sync controls in settings/onboarding.

## Required Screens

1. Onboarding / credentials
   - Ask for Terna Developer `client_id` and `client_secret`.
   - Call `POST /settings/credentials`.
   - Then call `POST /settings/credentials/test`.
   - Explain that credentials stay local.

2. Data sync — download everything, select later
   - The user picks only a year range (default: current year minus 6 … current year).
   - The frontend always sends all four datasets, the union of known sources and both
     `Lorda`/`Netta`. The backend maps sources per dataset (e.g. Bioenergie is skipped
     for generation plants) and reports them as `empty_steps`, never as failures.
   - Call `POST /sync/jobs`, poll `GET /sync/jobs/{job_id}` until done/error.
   - Show `GET /metadata/availability` (per dataset/year row counts) so users see what
     is already stored. A full multi-year download is a few MB.

3. Dashboard
   - Filters panel (exploration, not download selection):
     - Year range
     - Dataset
     - Geography level: national / region / province
     - Region
     - Province
     - Source/type
     - Capacity type: **Lorda or Netta, exactly one (default Lorda)**.
   - KPI cards (stock semantics):
     - Installed stock of the **latest year** (`latest_total_efficient_power_mw`, or
       `latest_total_installed_capacity_gw` for the national dataset)
     - Added vs previous year (`yoy_new_mw`/`yoy_new_gw`, `yoy_pct`)
     - Year range in stored data + latest data year
   - Main visualizations:
     - Capacity over time (compound `year,source` stacked area)
     - Source mix stacked bar (shares the same query)
     - Annual additions by source (YoY delta of stock, client-side)
     - Capacity by source / by type (single split, `latest_only=true`)
     - Capacity by region/province top 15 (`latest_only=true`)
   - Data table: sortable, searchable, paginated, export filtered rows to CSV.
   - Methodology note: latest-year stock, single index, YoY additions are net of
     decommissioning, efficient power (Developer API) vs nominal power (Gaudì).

4. Exports
   - Every chart: copy as PNG, save PNG, save SVG.
   - CSV export calls backend `GET /export/csv`.

## Backend Base URL

Development: `http://127.0.0.1:8765`. In the packaged app, Tauri discovers the local sidecar port.

## Cardinal rules (learned from real data)

1. **Never sum across capacity types.** Lorda ≈ Netta, so summing both doubles every MW.
   Analytics default to `Lorda` (`capacity_type_applied` in summary); the UI always sends one.
2. **Never sum stocks of different years.** Totals and by-source/by-region charts use the
   latest year (`latest_only=true`); multi-year views show per-year series or YoY deltas.
3. **Terna returns empty bodies, not errors**, for invalid values or years with no data yet.
   The backend normalizes these to zero-row steps (`empty_steps`).
4. `/installed-capacity` serves only the current year and the previous six, national only,
   types `[Thermal, Wind, Geothermal, Photovoltaic, Hydro]`, values in GW despite the
   `installed_capacity_GWh` field name. Its rows carry no `source`/`capacity_type`.

## API Summary

### Health

`GET /health`

### Credentials

`GET /settings/credentials/status`

`POST /settings/credentials` `{ "client_id": "string", "client_secret": "string" }`

`POST /settings/credentials/test`

### Sync

`POST /sync/jobs`

```json
{
  "years": [2021, 2022, 2023, 2024, 2025],
  "datasets": ["renewable_source_capacity", "generation_plants", "installed_capacity", "thermoelectric_capacity"],
  "sources": ["Fotovoltaico", "Eolico", "Idrico", "Bioenergie", "Geotermoelettrico", "Termoelettrico"],
  "capacity_types": ["Lorda", "Netta"]
}
```

`GET /sync/jobs/{job_id}` → `{ job_id, status, total_steps, completed_steps, message, error, failed_steps, empty_steps }`

### Options & availability

`GET /metadata/options` → known lists + `dataset_sources` (valid sources per dataset),
`default_capacity_type` ("Lorda"), `installed_capacity_year_window` (7), `database` distincts.

`GET /metadata/availability` → `{ datasets: { <name>: { years: [{ year, rows, sources, capacity_types }], total_rows, year_min, year_max, last_fetched } }, total_rows }`

### Records

`GET /records?dataset=renewable_source_capacity&year_from=2021&year_to=2025&region=Lombardia&source=Fotovoltaico&capacity_type=Lorda`

### Summary

`GET /analytics/summary?...same filters...` → base totals (all filtered rows, kept for
compatibility) plus stock fields: `latest_year`, `latest_total_efficient_power_mw`,
`latest_total_installed_capacity_gw`, `previous_year`, `previous_total_efficient_power_mw`,
`yoy_new_mw`, `yoy_new_gw`, `yoy_pct`, `capacity_type_applied`. **Display the latest_* fields.**

### Timeseries

`GET /analytics/timeseries?...same filters...&group_by=year,source&latest_only=false`

`group_by`: single (`year`, `region`, `province`, `source`, `capacity_type`, `category`,
`subcategory`, `type`) or compound (`year,source`, `year,type`, `year,region`,
`year,province`, `year,capacity_type`). `latest_only=true` restricts rows to MAX(year) in
the selection.

### CSV

`GET /export/csv?...same filters...`
