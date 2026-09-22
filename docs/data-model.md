# Data model and analytics

How the data is stored, what the numbers mean, and which dataset to trust.

## Tables

One row of `capacity_records` is a dataset × year × geography × source ×
capacity-type combination, upserted by a stable `record_key` (SHA-256 of the
dimension values), so re-syncing never duplicates rows.

The platform sometimes returns **several rows for the same key**. How they are
merged depends on the endpoint, and the yearbook decides which rule is right:

| Endpoint | Rows for one key | Rule |
| --- | --- | --- |
| `renewable-source-capacity` | one value + empty rows | largest non-empty value |
| `generation-plants` | one row per plant (Modena 2024: 213.193 and 1.001) | **sum**: with the largest, the 2024 thermoelectric total sits 1,5 MW below the yearbook |
| `thermoelectric-capacity` | the same row published twice (Modena "Celle combustibili" 1,0 and 1,0) | **largest**: summing put the totals 1,465 MW above the yearbook |
| `installed-capacity` | one row per type and year | largest |

The upsert also never overwrites a stored value with a `NULL`. Keeping the last
row instead is what used to lose photovoltaic capacity for 2021–2023.
When a sync receives a non-empty dataset/year response, it also removes cached
keys absent from that response. An empty response leaves the old year untouched:
Terna uses it for years that are not yet published.

| Column | Unit | Notes |
| --- | --- | --- |
| `dataset` | – | `renewable_source_capacity`, `generation_plants`, `installed_capacity`, `thermoelectric_capacity` |
| `year`, `region`, `province`, `source`, `category`, `subcategory`, `type`, `capacity_type` | – | dimension; `NULL` when the endpoint does not publish it |
| `efficient_power_mw` | MW | renewable, generation-plants and thermoelectric datasets |
| `installed_capacity_gw` | GW | national `installed_capacity` dataset only |
| `fetched_at` | ISO-8601 UTC | last successful fetch |

## Analytics rules

- **Stock, not sum.** Totals and `latest_only` aggregations refer to the latest
  year in the selection: summing several years counts the same plant several
  times.
- **One capacity index at a time.** `Lorda` (gross) and `Netta` (net) are never
  added together; `summary` defaults to `Lorda` and reports
  `capacity_type_applied`.
- **Year-on-year additions** are the delta of that stock between consecutive
  years in the selection — a proxy for new capacity, net of decommissioning.
  If the year immediately before the latest one is absent, the KPI is empty.
- **Missing values are `NULL`, upstream zeros are kept as `0`.** Terna answers
  unpublished years and combinations with an empty body; the sync counts those as
  `empty_steps`, never as failures.
- **A gap is an empty cell inside a series**: the value is missing in a year that
  sits between two years where the same province/source/index does carry a value.
  Empty cells before a series starts (photovoltaic in 2000) or after it ends are
  not gaps — `/metadata/data-quality` counts only the first kind.
- **The implicit index does not reach every route, and neither does the scope.**
  `summary` and `timeseries` apply `Lorda` when no `capacity_type` is given (and
  report it as `capacity_type_applied`); `/metadata/data-quality` does not, so it
  counts the gaps of both indexes unless one is passed explicitly (64 cells
  against 22 on the full cache). And without a `dataset` filter the totals cover
  every MW dataset at once while the national GW rows are left out:
  `GET /analytics/summary` with no filters answers
  `latest_total_installed_capacity_gw: null`, which the interface's formatters
  render as "—" (`formatMw`/`formatGw` return `—` for `null`). A total is only
  meaningful with a `dataset`.

## Precision and rounding

Three layers, three precisions — no value is ever wrong, but they are not
interchangeable:

| Layer | Precision | Example |
| --- | --- | --- |
| SQLite / JSON API | the raw double as received and stored | `7683.684599999993`, `22594.259` |
| CSV export | the same raw value, no rounding | `22594.259` |
| Interface | MW with 1 decimal (min 0), GW with exactly 2, counts plain, YoY deltas 1 decimal (2 for GW), percentages `toFixed(1)` | `22,594.3 MW` · `118.40 GW` · `+7,683.7 MW` · `+11.5%` |

The last row is `Intl.NumberFormat` (locale `en-US`) in `src/lib/utils.ts`
(`formatMw`, `formatGw`) and in the KPI cards, which is why its examples are
punctuated the English way. So an export compared automatically against the API
matches cell by cell; a number **read off the screen** is rounded, and a
difference in the last digits against the API or the yearbook is that rounding
plus the usual IEEE-754 noise, never a different measurement.

## Units and upstream quirks

- `/installed-capacity` labels its field `installed_capacity_GWh` but returns GW
  values (`"59.7902"` = 59.7902 GW). The parser follows the value, not the name.
- Numbers arrive as JSON numbers or as strings: most endpoints use a dot decimal
  (`"59.7902"`), older ones used a comma (`"14,243"`). Both are parsed correctly.
- Region names used to differ in casing between endpoints (`Valle D'Aosta` vs
  `Valle d'Aosta`), which showed up as two entries in the region filter. The sync
  now canonicalises every place name before storing it (`canonicalPlace`) and
  repairs the rows already in the cache at startup (`repairPlaceNames`), so the
  filter has **one** entry per region: `SELECT COUNT(*) FROM capacity_records
  WHERE region LIKE 'Valle%'` returns 542 rows, all of them `Valle D'Aosta`. The
  same repair covers the two provinces Terna spells with a zero
  (`Olbia0tempio` → `Olbia-Tempio`, `Verbano0cusio0ossola` →
  `Verbano-Cusio-Ossola`). The divergent spellings are history, not state.

## Which dataset to trust

The API does not revise older years the way the published yearbook does, and two
endpoints overlap with different perimeters. Status per dataset, measured against
the yearbook:

| Dataset | Series | Aligned? |
| --- | --- | --- |
| `generation_plants` | wind, photovoltaic, geothermal, hydro | ✅ every year (hydro includes pumped storage) |
| `thermoelectric_capacity` | national, per region, per category | ✅ to the decimal |
| `renewable_source_capacity` | wind, bioenergy | ✅ every year |
| `renewable_source_capacity` | geothermal | ✅ 2022 onwards (2021 is 4 MW lower) |
| `renewable_source_capacity` | photovoltaic | ✅ every year |
| `renewable_source_capacity` | hydro | ⚠️ excludes pure pumped storage by design (−3.986,3 MW in 2024) |
| `generation_plants` | thermoelectric series | ✅ matches the yearbook (62.109,905 MW in 2024) |
| `installed_capacity` | national GW by type | ❌ own perimeter, rounded; comparable only with itself |

Rules of thumb:

- the latest year is fine in any dataset;
- `renewable_source_capacity` and `generation_plants` agree cell by cell on wind,
  photovoltaic, bioenergy and geothermal; they differ on hydro, where
  `generation_plants` includes pure pumped storage;
- the API serves data up to 2024 (2025 is still empty at the source).

The generation endpoints publish from **2000** onwards (verified: 2000 answers
with 832 rows, 1999 is rejected) while `/installed-capacity` starts at **2021**.
The sync requests one year per dataset, so a year a dataset cannot serve is
skipped instead of failing, and the API clamps every requested range to
2000 → the current year.

The API limits a client to about one request per second (`403 Developer Over
Qps`, with `retry-after: 1`) and enforces a broader quota (`403 Developer Over
Rate`) that the client waits out instead of retrying into it.

Measurements, sources and the comparison with the press are in
[data-validation.md](data-validation.md).
