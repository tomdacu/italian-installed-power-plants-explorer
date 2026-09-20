# Data validation

How the numbers this app shows were checked, and how they relate to Terna's
official statistics. Reproduce it with your own credentials at any time.

## What was checked

| Level | Method | Result |
| --- | --- | --- |
| Raw payload → cache | Full sync of 2021–2024 × 4 datasets (108 steps), then row-by-row comparison of a sample of raw API values against the rows stored in SQLite | identical |
| Cache → API | 46 automated checks on the local API: uniqueness of rows, `/records` vs `/metadata/availability` counts, region sums vs province sums, `summary` stock vs `timeseries`, YoY deltas, Lorda ≥ Netta, CSV export vs served rows, sampled values | 45/46 |
| Cache → official statistics | National per-source totals (Tab. 8), thermoelectric per region (Tab. 18) and per category (Tab. 20) from Terna's yearbook *Dati statistici sull'energia elettrica in Italia* | see below |
| Province level | The two independent endpoints that publish the same sources (`renewable_source_capacity` and `generation_plants`) compared province by province | 297 of 304 pairs identical |

The single failing check is an upstream quirk, not a defect: for a handful of
province/year cells Terna returns `0` (or omits the value) for one capacity
index — mostly hydro *Lorda* — so `Lorda ≥ Netta` does not hold there. The app
stores what the API returns; totals are unaffected.

## Dataset alignment at a glance

Not every series is aligned with the official publications in the same way. This
is the status of each dataset of the app, measured against Terna's yearbook, the
registry series it publishes monthly and independent re-analyses:

| Dataset | Series | Status | Detail |
| --- | --- | --- | --- |
| `renewable_source_capacity` | wind, bioenergy | ✅ aligned | every year 2021–2024, to the decimal |
| `renewable_source_capacity` | geothermal | ✅ aligned | 2022–2024 exact; 2021 is 817,09 vs 821 MW published (−4 MW) |
| `renewable_source_capacity` | photovoltaic | ⚠️ aligned only for 2024 | 2021–2023 are the figures *as first published*, never revised: −2.464 / −1.773 / −3.340 MW against the yearbook |
| `renewable_source_capacity` | hydro | ⚠️ different perimeter **and** stale history | by design it excludes pure pumped storage (−3.986,3 MW in 2024, the seven provinces listed below); 2021–2023 are also below the registry series (−2.762 / −5.103 / −2.465 MW), 2024 matches it exactly |
| `generation_plants` | wind, photovoltaic, geothermal, hydro | ✅ aligned | every year 2021–2024, to the decimal (hydro **includes** pumping, as the yearbook does) |
| `generation_plants` | thermoelectric | ❌ divergent | 2024 is 3.468,0 MW (−5,6 %) below both the yearbook and the platform's own thermoelectric endpoint, concentrated in six regions |
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
| 2021 | Fotovoltaico | 20 130.19 | 22 594.3 | −2 464.1 |
| 2021 | Idrico | 16 409.71 | 23 147.3 | −6 737.6 |
| 2022 | Eolico | 11 858.43 | 11 858.4 | **exact** |
| 2022 | Fotovoltaico | 23 291.02 | 25 063.9 | −1 772.9 |
| 2022 | Idrico | 14 162.34 | 23 209.6 | −9 047.3 |
| 2023 | Eolico | 12 335.54 | 12 335.5 | **exact** |
| 2023 | Fotovoltaico | 26 979.79 | 30 319.4 | −3 339.6 |
| 2023 | Idrico | 16 809.39 | 23 260.5 | −6 451.1 |
| 2024 | Eolico | 12 990.30 | 12 990.3 | **exact** |
| 2024 | Fotovoltaico | 37 002.14 | 37 002.1 | **exact** |
| 2024 | Geotermoelettrico | 817.09 | 817.1 | **exact** |
| 2024 | Idrico | 19 637.16 | 23 623.5 | −3 986.3 |
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

### Where the photovoltaic gap comes from, province by province

Comparing the two endpoints cell by cell (same year, province, source and
capacity index) explains the whole difference:

| Year | Cells compared | Identical | Empty in `renewable_source_capacity` | Sum of the empty cells |
| --- | --- | --- | --- | --- |
| 2021 | 107 | 101 of 101 comparable | 6 (Udine, Ancona, Foggia, Taranto, Padova, Treviso) | −2 464,1 MW |
| 2022 | 107 | 102 of 102 | 5 (Udine, Milano, Varese, Ancona, Taranto) | −1 772,9 MW |
| 2023 | 107 | 100 of 100 | 7 (Udine, Milano, Varese, Ancona, Torino, Trento, Treviso) | −3 339,6 MW |
| 2024 | 107 | 107 of 107 | none | 0 |

The same pattern applies to hydro, where the empty cells (Brescia, Trento,
Torino, Varese…) are the pumped-storage provinces, on top of the perimeter
difference described below. `generation_plants` carries those cells, which is
why it reproduces the yearbook for every year.

An empty cell is only counted as missing when the same key carries a value in
another year: provinces that never host a source (no geothermal plant in
Lombardy) stay empty in every file and are not gaps.

### One upstream inconsistency worth knowing

Inside the `generation_plants` endpoint, the `Termoelettrico` series reports
**3.468,0 MW less** than both the yearbook and the dedicated thermoelectric
endpoint (58.641,91 vs 62.109,905 MW, −5,6 %), concentrated in Friuli-Venezia
Giulia (−1.042,3), Puglia (−1.217,7), Marche (−468,7), Lombardia (−321,4),
Emilia-Romagna (−213,5) and Veneto (−204,3). Every other source in that endpoint
matches the yearbook exactly, and the same total fetched through
`/thermoelectric-capacity` is correct — so the discrepancy lives in the platform
endpoint, not in the app or its parsing. Use the *Thermoelectric capacity*
dataset for thermal figures; the region totals of *Generation plants* inherit the
gap in those six regions.

Practical rule: this app reports the **Terna Developer API**, so it is the right
tool for trends, regional comparisons and export — not for quoting official
national statistics, where Terna's yearbook (or GSE) is the reference.

## Reproducing the validation

```bash
# local server on the fixed dev port
bun run serve --no-window --port 8731

# full sync of four years (needs credentials; ~108 API requests, a few minutes)
curl -X POST http://127.0.0.1:8731/sync/jobs -H "Content-Type: application/json" `
  -d '{\"years\":[2021,2022,2023,2024],\"datasets\":[\"renewable_source_capacity\",\"generation_plants\",\"installed_capacity\",\"thermoelectric_capacity\"],\"sources\":[\"Bioenergie\",\"Eolico\",\"Fotovoltaico\",\"Geotermoelettrico\",\"Idrico\",\"Termoelettrico\"],\"capacity_types\":[\"Lorda\",\"Netta\"]}'

# per-source totals for one year
curl "http://127.0.0.1:8731/analytics/timeseries?dataset=renewable_source_capacity&capacity_type=Lorda&year_from=2024&year_to=2024&group_by=source"
```

## API quota

Besides the per-second limit (`Developer Over Qps`), Terna enforces a broader
request quota: a four-year "download everything" run (~108 requests) can trip
`403 Developer Over Rate`, after which requests keep failing until the quota
window resets. The sync never aborts — it retries with backoff, reports the
affected steps as `failed_steps`, and already stored steps are upserted, so
re-running it later fills the gaps without duplicating rows.

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
| New renewable capacity in 2024 | +7.700 MW (our deltas) | **+7.480 MW** | Terna, *Rapporto mensile dicembre 2024* |
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

### Next validation to run (2025)

The 2025 edition of the yearbook is already published, so the next sync can be
checked against it. Expected values (gross efficient power, national):

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
