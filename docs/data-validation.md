# Data validation

How the numbers this app shows were checked, and how they relate to Terna's
official statistics. Reproduce it with your own credentials at any time.

## What was checked

| Level | Method | Result |
| --- | --- | --- |
| Raw payload → cache | Full sync of 2000–2024 × 3 datasets plus 2021–2024 of the national one (87 steps), then row-by-row comparison of a sample of raw API values against the rows stored in SQLite | identical |
| Cache → API | Automated checks on the local API: uniqueness of rows, `/records` vs `/metadata/availability` counts, region sums vs province sums, `summary` stock vs `timeseries`, YoY deltas, Lorda ≥ Netta, CSV export vs served rows, sampled values | all green |
| Cache → official statistics | National per-source totals (Tab. 8), thermoelectric per region (Tab. 18) and per category (Tab. 20) from Terna's yearbook *Dati statistici sull'energia elettrica in Italia* | see below |
| Province level | The two independent endpoints that publish the same sources (`renewable_source_capacity` and `generation_plants`) compared province by province | 297 of 304 pairs identical |

`Lorda ≥ Netta` now holds for every row of every dataset: the handful of
violations seen before were the duplicate-row bug, where an empty *Lorda* row
replaced a stored value.

## Dataset alignment at a glance

Not every series is aligned with the official publications in the same way. This
is the status of each dataset of the app, measured against Terna's yearbook, the
registry series it publishes monthly and independent re-analyses:

| Dataset | Series | Status | Detail |
| --- | --- | --- | --- |
| `renewable_source_capacity` | wind, bioenergy | ✅ aligned | every year 2021–2024, to the decimal |
| `renewable_source_capacity` | geothermal | ✅ aligned | 2022–2024 exact; 2021 is 817,09 vs 821 MW published (−4 MW) |
| `renewable_source_capacity` | photovoltaic | ✅ aligned | every year 2021–2024, to the decimal (this was the dataset the duplicate-row bug hit) |
| `renewable_source_capacity` | hydro | ⚠️ different perimeter | by design it excludes pure pumped storage (−3.986,3 MW in 2024, the seven provinces listed below); every other cell matches `generation_plants` |
| `generation_plants` | wind, photovoltaic, geothermal, hydro | ✅ aligned | every year 2021–2024, to the decimal (hydro **includes** pumping, as the yearbook does) |
| `generation_plants` | thermoelectric | ✅ aligned | 62.109,905 MW in 2024, identical to the yearbook (the earlier 3.468 MW gap was the duplicate-row bug) |
| `thermoelectric_capacity` | national, per region, per category | ✅ aligned | Tab. 8 (62.109,905 MW), Tab. 18 (all 20 regions) and Tab. 20 (35.419,912 / 26.689,993 MW) match to the decimal |
| `thermoelectric_capacity` | per subcategory | ➖ not verified | no published table found for the subcategory breakdown (ciclo combinato, turbine a gas…) |
| `installed_capacity` | national GW by type | ❌ different perimeter | 2022, in GW: thermal 58,8 vs 63,2 published, hydro 22,8 vs 23,2, photovoltaic 24,2 vs 25,1, wind 11,7 vs 11,9, geothermal 0,9 vs 0,8 — the endpoint publishes its own aggregate, rounded to 0,1 GW |

What to do with it:

- **Quoting 2024?** Any dataset works.
- **Quoting earlier years?** Use `generation_plants` for photovoltaic and hydro:
  it reproduces the yearbook for every year. The dashboard shows an amber
  *Partial data* note whenever the selected year range contains an empty cell.
- **Quoting thermoelectric?** Use `thermoelectric_capacity`, never the
  `Termoelettrico` series of `generation_plants`.
- **Comparing with a newspaper?** Check the perimeter first — see
  [Why newspapers quote different numbers](#why-newspapers-quote-different-numbers).
- **Using `installed_capacity`?** Only for its own trend; do not compare it with
  the yearbook's per-type values.

## Comparison with the official Terna yearbook

Values in MW, potenza efficiente **lorda** at 31 December, aggregated with a
single capacity index (no double counting).

| Year | Source | App (Terna Developer API for 2024 exports) | Terna yearbook (Tab. 8) | Δ |
| --- | --- | --- | --- | --- |
| 2021 | Eolico | 11 289.81 | 11 289.8 | **exact** |
| 2021 | Geotermoelettrico | 817.09 | 817.1 | **exact** |
| 2021 | Fotovoltaico | 22 594.3 | 22 594.3 | **exact** |
| 2021 | Idrico | 19 172.3 | 23 147.3 | −3 975.0 (pumping) |
| 2022 | Eolico | 11 858.43 | 11 858.4 | **exact** |
| 2022 | Fotovoltaico | 25 063.9 | 25 063.9 | **exact** |
| 2022 | Idrico | 19 265.3 | 23 209.6 | −3 944.3 (pumping) |
| 2023 | Eolico | 12 335.54 | 12 335.5 | **exact** |
| 2023 | Fotovoltaico | 30 319.4 | 30 319.4 | **exact** |
| 2023 | Idrico | 19 274.2 | 23 260.5 | −3 986.3 (pumping) |
| 2024 | Eolico | 12 990.30 | 12 990.3 | **exact** |
| 2024 | Fotovoltaico | 37 002.14 | 37 002.1 | **exact** |
| 2024 | Geotermoelettrico | 817.09 | 817.1 | **exact** |
| 2024 | Idrico | 19 637.2 | 23 623.5 | −3 986.3 (pumping) |
| 2024 | Termoelettrico | 62 109.91 | 62 109.9 | **exact** |

Cross-checks with independent publications: GSE *Rapporto Statistico 2024 Solare
Fotovoltaico* reports 37 002 MW of photovoltaic at 31/12/2024, identical to both
Terna and this app; the Terna/SISTAN summary for 2024 reports 137.6 GW of gross
efficient power (+5.7%) and 74.5 GW of renewable capacity.

## What the differences mean

- **Exact matches on wind, geothermal and thermoelectric** confirm that the
  sync, the unit parsing and the aggregation are correct.
- **Hydro**: the API series is lower than the yearbook. In 2024 the gap equals
  the pure pumped-storage capacity that GSE removes when it reconciles Terna's
  hydro figure (3 986.3 MW); in 2021–2023 the gap is larger and not explained by
  pumping alone, so the endpoint's perimeter (producers vs self-producers, plant
  size, date of the snapshot) is narrower than the yearbook's.
- **Photovoltaic 2021–2023**: the API reports less than the yearbook, while 2024
  matches to the decimal. The difference is **not** a revision of older figures:
  in those year files Terna leaves a handful of provinces empty (6 in 2021, 5 in
  2022, 7 in 2023) and the app stores them as NULL. Every province that *does*
  carry a value is identical to `generation_plants` and to the yearbook to the
  decimal, and the sum of the empty cells is exactly the gap
  (−2 464,1 / −1 772,9 / −3 339,6 MW). The dashboard flags those years as partial.
- **National installed capacity dataset**: the `/installed-capacity` endpoint
  returns rounded GW values on its own perimeter (2022: thermal 58.8 GW, hydro
  22.8, PV 24.2, wind 11.7, geothermal 0.9) that do **not** coincide with the
  yearbook's (thermal 63.2, hydro 23.2, PV 25.1, wind 11.9, geothermal 0.8).
  Do not compare that dataset 1:1 with published statistics.

### Thermoelectric dataset, checked at three levels

The 2024 edition of the yearbook publishes the thermoelectric breakdown twice, so
the dataset can be checked beyond the national total:

| Level | Source | App | Δ |
| --- | --- | --- | --- |
| National, gross | Tab. 8 `termoelettrici` 62.109,9 MW | 62.109,905 MW | **exact** |
| By region (all 20) | Tab. 18 `ITALIA` column, e.g. Lombardia 12.706,9 · Veneto 2.683,0 · Friuli 1.530,9 · Puglia 6.490,5 · Marche 503,2 · Emilia 6.742,9 · Valle d'Aosta 14,1 | identical for every region | **exact** |
| By category | Tab. 20 group A (electricity only) 35.419,9 MW · group B (combined heat and power) 26.690,0 MW | *Non cogenerative* 35.419,912 · *Cogenerative* 26.689,993 | **exact** |

### Province level, and the two hydro perimeters

`renewable_source_capacity` and `generation_plants` are separate endpoints that
publish the same four renewable sources. Comparing them province by province for
2024: **297 of 304 comparable pairs are identical to the decimal**; all seven
differences are hydro, and they sum to **3.986,301 MW** — exactly the pure
pumped-storage capacity the yearbook lists under `di cui pompaggio puro`
(3.986,3 MW), in Cuneo, Varese, Caserta, Siracusa, Bologna, Palermo and Bolzano.

So the two datasets differ by design, not by error:

| Dataset | Hydro perimeter | 2024 |
| --- | --- | --- |
| `renewable_source_capacity` | excludes pure pumped storage | 19.637,16 MW |
| `generation_plants` | includes it | 23.623,46 MW (yearbook: 23.623,5) |

### The duplicate-row bug (fixed in 1.0.0)

The 2021–2023 photovoltaic totals used to be 2.464/1.773/3.340 MW below the
yearbook, and the same defect depressed hydro and the thermoelectric series of
`generation_plants`. The cause was not Terna's data being stale: for some cells
the platform publishes **several rows for the same key**, one carrying the value
and the others empty. The sync kept only the last of them, so whenever an empty
row came after the filled one the value was dropped. In the 2023 payload:

| | Rows | Distinct keys | Duplicated keys | Of which |
| --- | --- | --- | --- | --- |
| `renewable-source-capacity` | 1.160 | 1.070 | 66 | 44 with one value + empties, 22 all empty |
| `generation-plants` | 868 | 846 | 22 | 22 with two different values (fragments to sum) |

Milan's photovoltaic row for 2023 arrived as `null, 598.943, null`: the value was
there, the app just kept the wrong row. The ingestion now merges duplicates —
empty rows add nothing, fragments are summed — and the upsert never overwrites a
stored value with a NULL. How duplicate rows are merged is per endpoint, and the yearbook decides: rows
that are distinct plants are summed (`generation-plants`), rows that are the same
publication repeated are not (`thermoelectric-capacity`, where summing put the
2024 total 1,465 MW above the official figure). After the fix every photovoltaic
cell (428 of 428) is identical to `generation_plants` and to the yearbook, and
`Lorda ≥ Netta` holds for every row.

### What is still genuinely upstream

- **Hydro perimeter**: `renewable_source_capacity` excludes pure pumped storage
  (−3.986,3 MW in 2024), `generation_plants` includes it.
- **A handful of empty cells inside a series**: the dashboard's amber note counts
  them (22 cells across 2001–2010 with the default filters). Empty cells *before*
  a series starts — photovoltaic in 2000, when it did not exist in most provinces
  — are not gaps and are not counted.
- **`Accumulo stand alone`** (standalone storage) appears in `generation_plants`
  from 2023 and is synced like every other source.
- **Region spelling**: thermoelectric rows say `Valle d'Aosta`, the other
  datasets `Valle D'Aosta`; the two are the same region.

Practical rule: this app reports the **Terna Developer API**, so it is the right
tool for trends, regional comparisons and export — not for quoting official
national statistics, where Terna's yearbook (or GSE) is the reference.

## Reproducing the validation

```bash
# local server on the fixed dev port
bun run serve --no-window --port 8731

# full sync of every published year (needs credentials; ~87 requests, ~2 minutes)
curl -X POST http://127.0.0.1:8731/sync/jobs -H "Content-Type: application/json" `
  -d '{\"years\":[2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024],\"datasets\":[\"renewable_source_capacity\",\"generation_plants\",\"installed_capacity\",\"thermoelectric_capacity\"]}'

# per-source totals for one year
curl "http://127.0.0.1:8731/analytics/timeseries?dataset=renewable_source_capacity&capacity_type=Lorda&year_from=2024&year_to=2024&group_by=source"
```

## API limits

Measured against the live API with valid credentials:

| Limit | Evidence | How the app handles it |
| --- | --- | --- |
| ~1 request per second | `403 Developer Over Qps` with `retry-after: 1` when two calls land in the same second (the token call counts too) | requests are paced 1.2 s apart, token included |
| Broader quota | older runs tripped `403 Developer Over Rate` after ~100 requests in quick succession | the client pauses **every** request for 60 s (doubling up to 10 min) and honours `retry-after`, instead of burning retries |
| Token lifetime | `expires_in: 298` | the token is reused until 30 s before expiry |

The bigger fix was asking for less: the sync used to request one year × source ×
index combination (27 calls per year, 108 for four years) even though a single
call per dataset and year returns **everything** — 1.160 rows for
`renewable-source-capacity 2023`, 1.192 for `thermoelectric-capacity 2023`.
A four-year download is now 16 calls; a five-year one (2021–2025, of which 2025
is empty) is 20 calls and takes about half a minute. A failed step never aborts
the job: it is counted in `failed_steps` and re-running the sync later fills the
gap, because rows are upserted by key.

## Cross-check with the press and independent analyses

The figures this app shows were also compared with what newspapers, industry
associations and independent re-analyses publish for 2024 — not to demand exact
equality, but to see whether the magnitudes and the trends are the same story.

| Figure (end of 2024) | This app (Terna API) | Publicly reported | Source |
| --- | --- | --- | --- |
| Photovoltaic | 37,00 GW | **37,08 GW** | Italia Solare, *Comunicato stampa*, 20 Feb 2025 |
| Photovoltaic | 37,00 GW | **≈ 37 GW** | SISTAN, *Il solare fotovoltaico in Italia* |
| Renewable capacity | 74,43 GW (4 sources) | **74,5 GW** | DataCivicLab, *Terna capacità rinnovabile 2015-2024* |
| Wind | 12,99 GW | **12,99 GW** | DataCivicLab (same series) |
| Hydro (excl. pumping) | 19,64 GW | **19,64 GW** | DataCivicLab (same series) |
| Total installed, gross efficient | 137,60 GW (+5,7 %) | **137,6 GW, +5,7 % vs 2023** | Terna, *Pubblicazioni statistiche* |
| New renewable capacity in 2024 | +7.700 MW (our deltas, net index) · +7.683,7 MW (gross, the dashboard default) | **+7.480 MW** | Terna, *Rapporto mensile dicembre 2024* |
| New photovoltaic in 2024 | +6.683 MW (our deltas) | **+6.795 MW** | Terna, *Rapporto mensile dicembre 2024* |
| Trend into 2025 | not in the API yet | **145,9 GW, +6 % vs 2024** | Terna, *Pubblicazioni statistiche* |

Magnitudes, shares and growth rates agree; the residual differences (0,2 % on
photovoltaic, 1,6–3 % on annual additions) are the usual distance between a
consolidated annual publication and a monthly/registry snapshot.

### Which series to trust, year by year

The two datasets were also compared with the revised published series for every
year they cover, because the Terna API does **not** revise older years the way
the yearbook does:

| Source | 2021 | 2022 | 2023 | 2024 |
| --- | --- | --- | --- | --- |
| Photovoltaic — *Generation plants* | ✅ | ✅ | ✅ | ✅ |
| Photovoltaic — *Renewable source capacity* | −2.464 | −1.773 | −3.340 | ✅ |
| Wind — both datasets | ✅ | ✅ | ✅ | ✅ |
| Bioenergy — both datasets | ✅ | ✅ | ✅ | ✅ |
| Geothermal — both datasets | ✅ (≈) | ✅ | ✅ | ✅ |
| Hydro incl. pumping — *Generation plants* | ✅ | ✅ | ✅ | ✅ |
| Hydro excl. pumping — *Renewable source capacity* | −2.762 | −5.103 | −2.465 | ✅ |

### Why newspapers quote different numbers

Different publications quote different figures for the same quantity, and the
difference is always a perimeter, not an error. Reading them side by side:

| Figure (end of 2024) | Values in circulation | What changes |
| --- | --- | --- |
| Renewable capacity | **76,6 GW** (Terna press release, 16 Jan 2025) · **74,5 GW** (yearbook, via SISTAN) · **73,52 GW** (ANIE) · **74,3 GW** (Legambiente) | the press release counts provisional data and a wider basket; ANIE counts only plants in its registry; the yearbook is the consolidated figure (74.433 MW by our datasets, 74,5 GW rounded) |
| Hydro | **18,99 GW** (ANIE) · **19,64 GW** (no pumped storage) · **22,9 GW** (TEHA/Enel) · **23,62 GW** efficient gross incl. pumping · **24,98 GW** nominal (Terna) | pumping in or out, and *nominal* vs *efficient* power — the same plant can legitimately appear as two different numbers |
| New capacity in 2024 | **7.480 MW** (Terna, net of repowering and decommissioning) · **6.664 MW** (ANIE, new installations only) · our deltas +7.700 MW (renewables) / +6.683 MW (photovoltaic) | gross additions vs net variation |
| Photovoltaic | **37,08 GW** (Terna, provisional Gaudì data) · **37.002 MW** (yearbook) · **36,68 GW** (ANIE) | provisional vs consolidated, registry coverage |

Terna itself states it in the monthly report: the 2024 figures are *provisional*
until the yearbook is published. When you compare this app with a newspaper,
check the perimeter first — and prefer the yearbook for anything you need to
cite.

Practical consequences:

- **For 2024 everything lines up** with the official publications, whichever
  dataset you pick.
- **For 2021–2023 prefer *Generation plants***: its photovoltaic and hydro series
  match the yearbook, while *Renewable source capacity* still carries the figures
  as they were published at the time (before later revisions).
- Wind, bioenergy and geothermal are consistent across datasets and years.
- Treat the API as a **current** source: re-sync before quoting a year, and fall
  back to the yearbook for historical series.

### 2025: published in the yearbook, not yet in the API

The 2025 edition of the yearbook is published, but **the Developer API returns no
2025 rows at all** (checked on all four generation endpoints with valid
credentials: empty responses, `empty_steps` in the sync). The app therefore shows
2021–2024. When Terna publishes 2025, re-run the sync and check it against these
values (gross efficient power, national):

| Source | 2025 (yearbook) |
| --- | --- |
| Total installed | 145.895,2 MW |
| Photovoltaic | 43.687,4 MW |
| Wind | 13.525,0 MW |
| Hydro (incl. pumping) | 23.638,6 MW |

Press coverage of the same period: photovoltaic additions of 6.437 MW and wind
additions of 608 MW in 2025 (ANIE), 39.885 MW cumulative photovoltaic at the end
of June 2025 and more than 40 GW in July (Italia Solare), 57 GW of solar and wind
combined at the end of 2025 (Terna, adequacy report).
