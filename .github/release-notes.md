<!-- Release notes template used by .github/workflows/release.yml (body_path).
     Replace the version heading and the "What's new" section for each release. -->

## Version 1.1.0

### What's new

Everything here is about the app doing what it already promised — same data, same
sync, fewer surprises.

- **The records table sorts again.** Clicking the *Type* header returned an error
  and replaced the whole table with it; every column of the table now orders
  server-side and the count in the header stays honest ("showing 20.000 of
  68.482").
- **Credentials work again.** *Save*, *Test connection* and *Remove* no longer
  answer 403.
- **Free-text search** across region, province, source, category, type and year,
  entirely in the local database, and the total shown while you type is the one
  of the search you are looking at, not of the previous one.
- **Year menus follow the dataset.** With *Installed capacity (national)*
  selected, the pickers offer 2021–2022 instead of years that dataset has never
  published, so the dashboard can no longer end up silently empty.
- **The sync default range follows what Terna has published.** With data in the
  cache it ends at the latest year you actually have, instead of asking for
  years Terna has not published yet. On a first start the cache is empty and
  there is nothing to follow, so it ends at the last complete year (the current
  one minus one): a sensible guess, not a promise — Terna publishes with a lag,
  so a year it has not released yet can still come back empty, and the sync
  reports it as such when it ends. Any year the API accepts can still be entered
  by hand.
- **Skipped and empty steps are told apart.** Years outside the range the app
  accepts, and years a dataset does not publish, are counted in `skipped_steps` —
  one step per dataset, so `total_steps + skipped_steps` is still the whole
  request — and reported as such ("outside the requested range or not published
  by the selected datasets"), separate from the empty or failed ones; "All done"
  only appears when nothing was skipped.
- **The CSV export contains every row of the selection.** It used to stop
  silently at 100 000 rows while the documentation promised all of them.
- **Accessibility**: the primary buttons, the small status labels and the version
  chip now meet WCAG AA contrast in both themes.
- **Better diagnostics**: runtime errors and startup failures end up in
  `backend.log`, the startup failure names the data path, and a rejected or
  unreadable port (`--port abc`, a malformed `ICE_PORT`) logs the port actually
  used instead of starting on a port nobody asked for.
- **Hardening**: an `Origin` without a port is no longer accepted, an HTTP/1.0
  request with no `Host` gets a `403` with the security headers instead of a
  `500`, and a short client id is no longer returned whole by the status route.
- **Documentation** rewritten where it contradicted the data: the photovoltaic
  series is complete and identical between the two datasets for 2021–2024, the
  hydro difference is the pumped-storage perimeter, the sync counters, the
  filtering rules and the rounding are described as they actually behave.

## Install or update

The package is not on npm yet: run the app from a checkout. Updating is
`git pull` followed by the same two commands.

On Windows there is also the release **zip**, and it needs no Bun at all:
`Italian-Renewable-Capacity-Explorer-<version>-win-x64.zip` holds the executable
**and** the interface it serves. Unzip it and run `ice.exe` from inside the
extracted folder; check the download against the `SHA256SUMS.txt` published next
to it. There is no bare `ice.exe` to download: without the `static/` folder
beside it, `GET /` answers `500` and the window stays empty.

```bash
git clone https://github.com/tomdacu/italian-renewable-capacity-explorer
cd italian-renewable-capacity-explorer
bun install
bun run prepack   # build the interface: the bundle is not in the repository,
                  # so `bun run serve` on a fresh clone would answer 500
bun run serve
```

Bun is a single binary: [bun.sh](https://bun.sh). Once the package is published
to npm, `bunx italian-renewable-capacity-explorer` will do the same in one line.

## Using it

1. Create a free application on [developer.terna.it](https://developer.terna.it)
   and paste Client ID and secret in **Credentials** — they stay on your machine
   (the secret is encrypted with Windows DPAPI, the macOS Keychain or
   `secret-tool`).
2. Open **Data sync**, choose the years and press *Download everything*. A
   multi-year sync takes a few minutes: Terna paces requests at about one per
   second.
3. Explore the **Dashboard**. Every chart can be copied as PNG or exported as
   SVG/CSV. In Chromium-based browsers you can install the app for a standalone
   window with its own icon.

Data comes from the Terna Developer API; this project is independent and not
affiliated with Terna S.p.A.
