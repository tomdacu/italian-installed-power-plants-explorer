# Data model and analytics

How the data is stored, what the numbers mean, and which dataset to trust.

## Tables

One row of `capacity_records` is a dataset × year × geography × source ×
capacity-type combination, upserted by a stable `record_key` (SHA-256 of the
dimension values), so re-syncing never duplicates rows.

The platform sometimes returns **several rows for the same key** — one with the
value and the others empty, or fragments that add up. The ingestion merges them
before writing (empty rows add nothing, fragments are summed) and the upsert
never overwrites a stored value with a `NULL`: keeping the last row instead is
what used to lose photovoltaic capacity for 2021–2023.

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
- **Year-on-year additions** are the delta of that stock between the last two
  years in the selection — a proxy for new capacity, net of decommissioning.
- **Missing values are `NULL`, upstream zeros are kept as `0`.** Terna answers
  unpublished years and combinations with an empty body; the sync counts those as
  `empty_steps`, never as failures. Only two cells are empty upstream (Trapani
  bioenergy 2023, Teramo wind 2024).

## Units and upstream quirks

- `/installed-capacity` labels its field `installed_capacity_GWh` but returns GW
  values (`"59.7902"` = 59.7902 GW). The parser follows the value, not the name.
- Numbers arrive as JSON numbers or as strings: most endpoints use a dot decimal
  (`"59.7902"`), older ones used a comma (`"14,243"`). Both are parsed correctly.
- Region names differ in casing between endpoints (`Valle D'Aosta` vs
  `Valle d'Aosta`), which shows up as two entries in the region filter.

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
