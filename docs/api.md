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
| `GET /sync/jobs/{id}` | `{status, total_steps, completed_steps, failed_steps, empty_steps, message, error}` |
| `GET /metadata/options` | canonical sources/types per dataset, stored options, `first_year` (2000), `installed_capacity_first_year` (2021) and `current_year` |
| `GET /metadata/availability` | row counts per dataset and year actually cached |
| `GET /metadata/data-quality` | per year, cells Terna left empty even though the same key has a value another year (filters: `dataset`, `capacity_type`, `source`) |
| `GET /records` | paged rows (`limit` ≤ 100000, `offset`) |
| `GET /analytics/summary` | latest-year stock, previous year, YoY delta, row count (all with a single capacity index; without an explicit `capacity_type` it applies `Lorda`) |
| `GET /analytics/timeseries` | grouped sums; `group_by=year,source`, `latest_only=true`; same implicit single index as `summary`, so a group by source never sums Lorda and Netta together |
| `GET /export/csv` | every row matching the filters, as CSV |

## Filters

Accepted by `/records`, `/analytics/*` and `/export/csv`:

`dataset`, `year_from`, `year_to`, `region`, `province`, `source`,
`capacity_type` (`Lorda`/`Netta`), `category`, `subcategory`, `type`.

Empty or missing parameters are ignored, so a bare `GET /records` returns the
first 5000 rows of everything stored. A value that is *present but unknown*
(`dataset=bogus`, `capacity_type=netta`) is a `400`, not a silently ignored
filter: answering with the whole database is worse than an error. `limit` (≤ 100000) and `offset` page the
result; the response carries `x-total-count` with the number of matching rows, so
a client can say "showing 20.000 of 68.482" instead of guessing. Non-numeric
values are rejected with `400`.

## Sync request

```json
{
  "years": [2000, 2001, "…", 2024],
  "datasets": ["renewable_source_capacity", "generation_plants",
               "installed_capacity", "thermoelectric_capacity"]
}
```

One request per dataset and year: the endpoints return every source and both
capacity indexes in a single response, so there is nothing to select here. Years
outside 2000 → the current year are clamped away, and a year a dataset cannot
serve (the national endpoint starts at 2021) is skipped and counted in
`empty_steps`, so a plan never fails because of a year Terna does not publish.

## Conventions

- `group_by` accepts single columns or compound expressions separated by comma,
  plus or space: `year`, `source`, `year,source`, `year+source`.
- Unknown `group_by` values are rejected with `400`, never interpolated into SQL.
- Errors use `{detail: "…"}`; Terna error bodies are cleaned of HTML before being
  returned.
- `timeseries` rows always carry every dimension column; the ones not grouped are
  `NULL`.
