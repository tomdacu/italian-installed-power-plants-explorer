# Local HTTP API

The server binds `127.0.0.1:8731` and serves both this JSON API and the
interface, from the same origin. Copies of the earlier Python/FastAPI backend
used the same routes, so anything written against it keeps working.

| Method & path | Purpose |
| --- | --- |
| `GET /health` | readiness probe → `{status: "ok"}` |
| `GET /settings/credentials/status` | `{configured, client_id_suffix}` (the secret is never returned) |
| `POST /settings/credentials` | store id + secret (`{client_id, client_secret}`) |
| `DELETE /settings/credentials` | remove both |
| `POST /settings/credentials/test` | OAuth2 round-trip against Terna → `{ok: true}` |
| `POST /sync/jobs` | start a sync job → `{job_id, status}` |
| `GET /sync/jobs/{id}` | `{status, total_steps, completed_steps, failed_steps, empty_steps, skipped_steps, message, error}` — `skipped_steps` is always present |
| `GET /metadata/options` | canonical sources/types per dataset, stored options, `first_year` (2000), `installed_capacity_first_year` (2021) and `current_year` |
| `GET /metadata/availability` | row counts per dataset and year actually cached |
| `GET /metadata/data-quality` | per year, cells Terna left empty even though the same key has a value another year (filters: `dataset`, `capacity_type`, `source`). It does **not** apply the implicit capacity index (see below): without `capacity_type` it counts the gaps of `Lorda` and `Netta` together — 64 cells across 14 years on the full cache, against 22 across 9 years with `capacity_type=Lorda` |
| `GET /records` | paged rows (`limit` ≤ 100000, `offset`), ordered by `sort`/`order` |
| `GET /analytics/summary` | latest-year stock, previous year, YoY delta, row count (all with a single capacity index; without an explicit `capacity_type` it applies `Lorda`) |
| `GET /analytics/timeseries` | grouped sums; `group_by=year,source`, `latest_only=true`; same implicit single index as `summary`, so a group by source never sums Lorda and Netta together |
| `GET /export/csv` | every row matching the filters, as CSV |

## Filters

Accepted by `/records`, `/analytics/*`, `/metadata/data-quality` and `/export/csv`:

`dataset`, `year_from`, `year_to`, `region`, `province`, `source`,
`capacity_type` (`Lorda`/`Netta`), `category`, `subcategory`, `type`, `q`.

`q` is a free-text search: a case-insensitive substring match against the
dimension columns (`region`, `province`, `source`, `category`, `subcategory`,
`type`, `capacity_type`, `dataset`) and the year, so `q=palermo` returns the
Palermo rows of every dataset.

An empty or missing parameter is ignored, and *both* spellings behave the same:
`dataset=` and no `dataset` at all return everything. The exceptions are `sort=`
and `group_by=`, which are read as they arrive — an empty value there is not a
default, it is a `400` (`sort must be one of: …`, `Unsupported group_by: `), and
nothing is returned. A value that is *present but unknown* (`dataset=bogus`,
`capacity_type=lor-da`, `sort=bogus`) is a `400` too, not a silently ignored
filter: answering with the whole database is worse than an error. Case is folded
for enumerated values, so `capacity_type=netta` is accepted and means `Netta`.

`limit` (default 5000, at most 100000) and `offset` (default 0) page the result;
non-numeric values are rejected with `400`. The response carries `x-total-count`
with the number of matching rows, so a client can say "showing 20.000 of 68.482"
instead of guessing — remember to read it through the `Access-Control-Expose-Headers`
header that publishes it.

`sort` names the ordering column and defaults to `year`; `order` is `asc`
(default) or `desc`, and anything else is read as `asc`. The accepted sort columns
are `dataset`, `year`, `region`, `province`, `source`, `capacity_type`, `type`,
`efficient_power_mw`, `installed_capacity_gw`; any other value is a `400` whose
`detail` lists them. The column is never interpolated from the request: the
whitelist is the only way in. The remaining dimensions are appended as
tie-breakers, so the order is total and two consecutive pages can neither repeat
nor skip a row.

A bare `GET /records` therefore returns the first 5000 rows of everything stored
— **about 1,4 MB of JSON** (measured: 1 472 121 bytes, `x-total-count: 68482`).
Ask for the page you need with `limit`/`offset`.

### Implicit capacity index, and what it does not cover

`summary` and `timeseries` apply a `capacity_type` nobody asked for when the
selection is a dataset that stores MW: with no explicit parameter they apply
`Lorda` (reported back as `capacity_type_applied`), so a `group_by=source` never
sums `Lorda` and `Netta` together and never doubles a megawatt. Two consequences
worth knowing:

- `/metadata/data-quality` is **outside** that rule: it counts the empty cells of
  the index you select, so a consumer that wants the gaps of one index must pass
  `capacity_type` explicitly (22 cells with it, 64 without).
- Without a `dataset` filter the MW total spans every MW dataset at once, while
  the national `/installed-capacity` rows (GW, no `capacity_type`) are left out
  of it: `GET /analytics/summary` with no filters answers
  `latest_total_installed_capacity_gw: null`, and the interface shows "—" for the
  national stock until a dataset is chosen. Pass `dataset` for a meaningful
  total.

## Sync request

```json
{
  "years": [2000, 2001, "…", 2024],
  "datasets": ["renewable_source_capacity", "generation_plants",
               "installed_capacity", "thermoelectric_capacity"]
}
```

One request per dataset and year: the endpoints return every source and both
capacity indexes in a single response, so there is nothing to select here.

Three different things can happen to a year you ask for, and the job reports them
apart:

- **Outside 2000 → the current year** the year is clamped away before the job
  exists; nothing counts it, and if no year survives the request is a `422`.
- **Inside the range but not published for that dataset** — the national endpoint
  starts at 2021 — the year never becomes a step: it is counted in
  `skipped_steps` (`total_steps` does not include it). The per-dataset first year
  is in [data-model.md](data-model.md#which-dataset-to-trust).
- **Executed and answered with an empty body** (a year Terna has not published
  yet): the step runs, stores nothing, and is counted in `empty_steps`.

So `total_steps + skipped_steps` covers everything the request asked for, and a
plan never fails because of a year Terna does not publish. `GET /sync/jobs/{id}`
returns all three counters plus `status`, `message` and `error`.

## Conventions

- `group_by` accepts single columns or compound expressions separated by comma,
  plus or space: `year`, `source`, `year,source`, `year+source`.
- Unknown `group_by` values are rejected with `400`, never interpolated into SQL.
- Errors use `{detail: "…"}`; Terna error bodies are cleaned of HTML before being
  returned.
- `timeseries` rows always carry every dimension column; the ones not grouped are
  `NULL`.
- Numbers are returned **as stored**: a JSON value carries the raw IEEE-754 double
  (`yoy_new_mw: 7683.684599999993`) and the CSV export writes the same unrounded
  value, so a value compared cell by cell between the two never differs by more
  than that float noise. Rounding is a presentation choice and lives in the
  interface — see
  [data-model.md](data-model.md#precision-and-rounding).
