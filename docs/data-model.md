# Data model and analytics

How the data is stored, what the numbers mean, and which dataset to trust.

## Tables

One row of `capacity_records` is a dataset × year × geography × source ×
capacity-type combination, upserted by a stable `record_key` (SHA-256 of the
dimension values), so re-syncing never duplicates rows.

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
  `empty_steps`, never as failures.

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
| `renewable_source_capacity` | photovoltaic | ⚠️ from 2024; 2021-2023 are the pre-revision figures |
| `renewable_source_capacity` | hydro | ⚠️ excludes pure pumped storage by design; older years are stale |
| `generation_plants` | thermoelectric series | ❌ ~3,5 GW low: use `thermoelectric_capacity` |
| `installed_capacity` | national GW by type | ❌ own perimeter, rounded; comparable only with itself |

Rules of thumb:

- the latest year is fine in any dataset;
- before the latest year prefer `generation_plants` for photovoltaic and hydro;
- for thermal figures always use `thermoelectric_capacity`.

Measurements, sources and the comparison with the press are in
[data-validation.md](data-validation.md).
