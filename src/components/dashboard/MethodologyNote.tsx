export function MethodologyNote() {
  return (
    <section className="card p-5">
      <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">
        About these numbers
      </h3>
      <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        <p>
          Totals and charts show the <strong className="font-semibold">stock of the latest available year</strong> in
          the selection, using a <strong className="font-semibold">single capacity index</strong> (Lorda by
          default — switch to Netta to compare). Summing years or both indexes would count the same megawatts
          several times.
        </p>
        <p>
          “Annual additions” are computed as the year-on-year change of that stock, a proxy for new installations
          (net of decommissioning).
        </p>
        <p>
          Wind, photovoltaic and geothermal agree to the decimal between{" "}
          <strong className="font-semibold">Renewable source capacity</strong> and{" "}
          <strong className="font-semibold">Generation plants</strong>, and every series reproduces Terna&apos;s
          yearbook for 2000–2024 (bioenergy exists only in <em>Renewable source capacity</em>). They differ on hydro: <em>Renewable source capacity</em> excludes pure pumped storage
          (−3,99 GW in 2024) while <em>Generation plants</em> includes it. For the thermal breakdown by category use{" "}
          <strong className="font-semibold">Thermoelectric capacity</strong>.{" "}
          <strong className="font-semibold">Installed capacity (national)</strong> uses its own perimeter and is only
          comparable with itself.
        </p>
        <p>
          Source: Terna Developer API (efficient power, annual files). Values can differ from the Gaudì platform,
          which publishes nominal power: the yearbook numbers for 2021–2024 match to the decimal. The API still
          serves no 2025 data, and a few province cells are empty upstream — the dashboard says so when a year is
          affected.
        </p>
      </div>
    </section>
  );
}
