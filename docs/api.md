# Local HTTP API

The server binds `127.0.0.1:8731` and serves both this JSON API and the
interface, from the same origin. Copies of the earlier Python/FastAPI backend
used the same routes, so anything written against it keeps working.

| Method & path | Purpose |
| --- | --- |
| `GET /health` | readiness probe → `{status: "ok", version, port, port_fallback}`: `version` is the app version, `port` the port actually bound, and `port_fallback` is `true` when the preferred port was busy and the server moved to a free one (an installed app stays bound to the old origin and has to be reinstalled) |
| `GET /settings/credentials/status` | `{configured, client_id_suffix}` (the secret is never returned) |
| `POST /settings/credentials` | store id + secret (`{client_id, client_secret}`) |
| `DELETE /settings/credentials` | remove both |
| `POST /settings/credentials/test` | OAuth2 round-trip against Terna → `{ok: true}` |
| `POST /sync/jobs` | start a sync job → `{job_id, status}` |
| `GET /sync/jobs/latest` | most recent active job, or the last finished job; 404 before any job starts |
| `GET /sync/jobs/{id}` | the job status, with every key always present and in the order `SyncJobStatus` (`shared/types.ts`) declares them: `{job_id, status, in_flight, total_steps, completed_steps, message, error, failed_steps, empty_steps, skipped_steps}`. `in_flight` is `true` exactly while the current step is still being awaited — so a reader that has just cancelled a job knows when the counters can still move — and `status` is one of `queued`, `running`, `completed`, `failed`, `cancelled` |
| `DELETE /sync/jobs/{id}` | cancel a queued or running job → `200` with the resulting status, whose `status` is `"cancelled"`. The step in flight is allowed to finish, the following ones are not executed, and the counters keep what was really done. An unknown id is a `404`; a job that has already finished is not modified and answers `200` with the status it already had |
| `GET /metadata/options` | canonical sources/types per dataset, stored options, `first_year` (2000), `installed_capacity_first_year` (2021) and `current_year` |
| `GET /metadata/availability` | row counts per dataset and year actually cached |
| `GET /metadata/data-quality` | per year, cells Terna left empty even though the same key has a value another year (filters: `dataset`, `capacity_type`, `source`). It does **not** apply the implicit capacity index (see below): without `capacity_type` it counts the gaps of `Lorda` and `Netta` together — 64 cells across 14 years on the full cache, against 22 across 9 years with `capacity_type=Lorda` |
| `GET /records` | paged rows (`limit` ≤ 100000, `offset`), ordered by `sort`/`order` |
| `GET /analytics/summary` | latest-year stock, previous year, YoY delta, row count (all with a single capacity index; without an explicit `capacity_type` it applies `Lorda`) |
| `GET /analytics/timeseries` | grouped sums; `group_by=year,source`, `latest_only=true`; same implicit single index as `summary`, so a group by source never sums Lorda and Netta together |
| `GET /export/csv` | every row matching the filters, as CSV |

## Mutating requests

The guard covers the four methods that change something — `POST`, `PUT`, `PATCH`
and `DELETE`, the exact contents of `MUTATING_METHODS` in `server/http.ts` — so
every mutating request the table shows, the credential routes, `POST /sync/jobs`
and `DELETE /sync/jobs/{id}`, must be sent with `Content-Type: application/json`,
**including the requests that carry no body at all** — every `DELETE` in the
table. The check runs before the route is looked up, so a request without the
header never reaches the handler: no credential is stored or removed and no job
is created or cancelled. `PUT` and `PATCH` have no route here — with the header
they are the ordinary `404` of an unknown path — but they are checked just the
same. Measured against a running server, with an id that does not exist:

```
$ curl -i -X DELETE http://127.0.0.1:8731/sync/jobs/00000000-0000-4000-8000-000000000000
HTTP/1.1 403 Forbidden
{"detail":"mutating requests must be sent as application/json"}
```

With the header the request is routed normally, and an unknown id is the `404`
the endpoint documents:

```
$ curl -i -X DELETE -H 'Content-Type: application/json' \
    http://127.0.0.1:8731/sync/jobs/00000000-0000-4000-8000-000000000000
HTTP/1.1 404 Not Found
{"detail":"Sync job not found"}
```

That same requirement is what protects the writes: a page from another origin
cannot send `application/json` without a CORS preflight, and this server does not
answer preflights, so no outside page can save credentials or cancel a sync. The
one exception is `ICE_DEV_ORIGIN` — see
[configuration.md](configuration.md#environment-variables), which also lists the
`403` a state-changing request from another origin gets.

### Cancelling a job from a command line

A job id is a `crypto.randomUUID()` and is announced in the answer to
`POST /sync/jobs` (and in `GET /sync/jobs/latest`); keep the `job_id` from
there, because there is no route that lists the earlier ones.

```bash
# 1. start a job — the answer is where the id comes from
curl -s -X POST http://127.0.0.1:8731/sync/jobs \
  -H 'Content-Type: application/json' \
  -d '{"years":[2024],"datasets":["generation_plants"]}'
{"job_id":"9c1a4f1e-0e0f-4d1a-9d6c-3b1e2f7a5c40","status":"queued"}

# 2. cancel it — same header, still no body
curl -s -X DELETE \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:8731/sync/jobs/9c1a4f1e-0e0f-4d1a-9d6c-3b1e2f7a5c40
{"job_id":"9c1a4f1e-0e0f-4d1a-9d6c-3b1e2f7a5c40","status":"cancelled",
 "in_flight":true,"total_steps":1,"completed_steps":0,
 "message":"Sync cancelled","error":null,"failed_steps":0,"empty_steps":0,
 "skipped_steps":0}
```

One dataset and one year is **one** step, so the plan of that request is
`total_steps: 1` — the counter counts dataset × year pairs, not years. The id in
the second call is the one the first call returned; a made-up UUID is the `404`
shown above. The cancel is idempotent: a known id always answers `200`, and a job
that has already finished comes back with the status it already had —
`completed` or `failed` — instead of being relabelled `cancelled`.

The step in flight is allowed to finish, so the answer above is not the end of
the story: `in_flight` is `true` because the single step was still being awaited
when the cancel landed, and `completed_steps` is `0`; a moment later the step
finishes — `in_flight` turns `false`, `completed_steps` reaches `1` and the status
stays `cancelled`. A cancel that lands before the job starts looks the same with
`in_flight: false` from the beginning, because no step ever runs. Read
`GET /sync/jobs/{id}` while `in_flight` is `true` and stop when it turns `false`.

Do not run this against the real credentials just to read the bodies: the two
JSON shapes printed here are what the code produces — a first `POST` answers
`200` with `{"job_id": …, "status": "queued"}`, and `cancel()` fills `message`
with `"Sync cancelled"` and `error` with `null` — while only the `403` and the
`404` above were measured against a running server, and those need no credential.
The step count is what `buildPlan` returns for those two arrays: see
[Sync request](#sync-request) below for how the counters add up.

## Filters

Accepted by `/records`, `/analytics/*`, `/metadata/data-quality` and `/export/csv`:

`dataset`, `year_from`, `year_to`, `region`, `province`, `source`,
`capacity_type` (`Lorda`/`Netta`), `category`, `subcategory`, `type`, `q`.

`q` is a free-text search: a case-insensitive substring match against the
dimension columns (`region`, `province`, `source`, `category`, `subcategory`,
`type`, `capacity_type`, `dataset`) and the year, so `q=palermo` returns the
Palermo rows of every dataset. It is capped at **200 characters**: a longer value
is a `400 {"detail":"q must be at most 200 characters"}` rather than a query the
connection cannot carry.

An empty or missing parameter is ignored, and *both* spellings behave the same:
`dataset=` and no `dataset` at all return everything. The exceptions are `sort=`
and `group_by=`, which are read as they arrive — an empty value there is not a
default, it is a `400` (`sort must be one of: …`, `Unsupported group_by: `), and
nothing is returned. A value that is *present but unknown* (`dataset=bogus`,
`capacity_type=lor-da`, `sort=bogus`) is a `400` too, not a silently ignored
filter: answering with the whole database is worse than an error. Case is folded
for `capacity_type` only, so `capacity_type=netta` is accepted and means `Netta`.
`dataset`, `sort` and `group_by` are matched exactly — `dataset=GENERATION_PLANTS`
answers `400 {"detail":"dataset must be one of: renewable_source_capacity,
generation_plants, installed_capacity, thermoelectric_capacity"}` and
`sort=YEAR` a `400` listing the sortable columns. The free-text dimensions are
not folded either: `source=Eolico` matches 6776 rows, `source=eolico` is a valid
filter that matches none, not an error.

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
- Without a `dataset` filter the MW total spans every MW dataset at once, and
  those datasets **overlap**: `generation_plants` already carries the four
  renewable sources and the thermoelectric series, so adding
  `renewable_source_capacity` and `thermoelectric_capacity` to it counts them a
  second time. Measured, `capacity_type=Lorda`: **2024**
  137 598,40 + 74 508,66 + 62 109,90 = **274 216,97 MW**
  (`latest_total_efficient_power_mw: 274216.9702`), and **2022**
  123 341,72 + 61 054,19 + 63 210,06 = **247 605,97 MW** — that is 2,1× the
  118,40 GW the national dataset reports for the same year 2022. The national
  `/installed-capacity` rows (GW, no `capacity_type`) are left out of the sum
  instead: `GET /analytics/summary` with no filters answers
  `latest_total_installed_capacity_gw: null`, and the interface shows "—" for the
  national stock until a dataset is chosen. **Always pass `dataset`**: without it
  the total is a number about nothing.

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

- **Outside 2000 → the current year** the year is dropped before the job exists
  and counted in `skipped_steps`, once for every dataset selected — the step it
  never became would have been one per dataset; if no year survives the request,
  the answer is a `422` and no job is created.
- **Inside the range but not published for that dataset** — the national endpoint
  starts at 2021 — the year never becomes a step: it is counted in
  `skipped_steps` (`total_steps` does not include it). The per-dataset first year
  is in [data-model.md](data-model.md#which-dataset-to-trust).
- **Executed and answered with an empty body** (a year Terna has not published
  yet): the step runs, stores nothing, and is counted in `empty_steps`.

`skipped_steps` is therefore in **step** units, exactly like `total_steps`: a
year that is dropped — outside the requested range, or not published by the
selected datasets — costs the step it would have been for each dataset, so the
two counters always add up:

```
total_steps + skipped_steps = unique years requested × datasets selected
```

A step is one dataset and one year, the datasets are the ones in the request
(all four when `datasets` is omitted, which is what the interface sends), and
repeated years are deduplicated before the plan is built. Three requests against
those four datasets:

| Years requested | `total_steps` | `skipped_steps` | Why |
| --- | --- | --- | --- |
| `[1999, 2024]` | 4 | 4 | 1999 is out of range: 1 year × 4 datasets, 2024 runs |
| `[2019, 2024]` | 7 | 1 | 2019 is in range but `installed_capacity` starts in 2021 |
| `[2024, 2024]` | 4 | 0 | the repeated year is deduplicated |

So the two counters cover everything the request asked for — out-of-range years
included — and a plan never fails because of a year Terna does not publish.
`GET /sync/jobs/{id}` returns all the counters plus `status`, `in_flight`,
`message` and `error`.

## Conventions

- `group_by` accepts single columns or compound expressions separated by comma,
  plus or space: `year`, `source`, `year,source`, `year+source`.
- Unknown `group_by` values are rejected with `400`, never interpolated into SQL.
- Errors use `{detail: "…"}`; Terna error bodies are cleaned of HTML before being
  returned.
- `timeseries` rows always carry every dimension column; the ones not grouped are
  `NULL`.
- **CSV export**: a field is quoted when it contains a `"`, a comma or a line
  break (inner quotes are doubled). A **number** is written exactly as stored and
  never touched: the apostrophe only hits *text* that starts with `=`, `+`, `-`,
  `@`, a tab or a carriage return, so a spreadsheet shows it as text instead of
  evaluating it as a formula (CWE-1236). A negative `efficient_power_mw` therefore
  stays negative, while a text cell such as `=cmd` becomes `'=cmd`. The apostrophe
  is part of the exported text — the JSON API does not add it.
- Numbers are returned **as stored**: a JSON value carries the raw IEEE-754 double
  (`yoy_new_mw: 7683.684599999993`) and the CSV export writes the same unrounded
  value, so a value compared cell by cell between the two never differs by more
  than that float noise. Rounding is a presentation choice and lives in the
  interface — see
  [data-model.md](data-model.md#precision-and-rounding).
