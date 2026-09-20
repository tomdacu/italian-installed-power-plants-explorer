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
| `GET /metadata/options` | canonical sources/types per dataset, stored options, year window |
| `GET /metadata/availability` | row counts per dataset and year actually cached |
| `GET /records` | paged rows (`limit` ≤ 100000, `offset`) |
| `GET /analytics/summary` | latest-year stock, previous year, YoY delta, row count |
| `GET /analytics/timeseries` | grouped sums; `group_by=year,source`, `latest_only=true` |
| `GET /export/csv` | every row matching the filters, as CSV |

## Filters

Accepted by `/records`, `/analytics/*` and `/export/csv`:

`dataset`, `year_from`, `year_to`, `region`, `province`, `source`,
`capacity_type` (`Lorda`/`Netta`), `category`, `subcategory`, `type`.

Empty or missing parameters are ignored, so a bare `GET /records` returns the
first 5000 rows of everything stored.

## Sync request

```json
{
  "years": [2021, 2022, 2023, 2024],
  "datasets": ["renewable_source_capacity", "generation_plants",
               "installed_capacity", "thermoelectric_capacity"],
  "sources": ["Bioenergie", "Eolico", "Fotovoltaico",
              "Geotermoelettrico", "Idrico", "Termoelettrico"],
  "capacity_types": ["Lorda", "Netta"]
}
```

The planner intersects the request with what each endpoint accepts (for example
`Bioenergie` does not exist for generation plants) and reports the combinations
it dropped as `empty_steps`, so a plan never fails because of a value Terna
ignores. Sources and types omitted in the request default to everything valid.

## Conventions

- `group_by` accepts single columns or compound expressions separated by comma,
  plus or space: `year`, `source`, `year,source`, `year+source`.
- Unknown `group_by` values are rejected with `400`, never interpolated into SQL.
- Errors use `{detail: "…"}`; Terna error bodies are cleaned of HTML before being
  returned.
- `timeseries` rows always carry every dimension column; the ones not grouped are
  `NULL`.
