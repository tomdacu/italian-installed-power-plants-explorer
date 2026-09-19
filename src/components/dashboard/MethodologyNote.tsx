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
          The two hydro series differ by design: <strong className="font-semibold">Renewable source capacity</strong>{" "}
          excludes pure pumped storage, <strong className="font-semibold">Generation plants</strong> includes it
          (+3,99 GW in 2024). For thermoelectric totals prefer the dedicated{" "}
          <strong className="font-semibold">Thermoelectric capacity</strong> dataset: the generation-plants endpoint
          reports about 3,5 GW less thermal capacity than the platform total. For years before the latest one,
          prefer <strong className="font-semibold">Generation plants</strong>: the renewable dataset still
          carries photovoltaic and hydro as they were first published, before Terna's later revisions.
        </p>
        <p>
          Source: Terna Developer API (efficient power). Values can differ from Terna Gaudì / statistical
          publications, which report nominal power with a different methodology and perimeter: wind, geothermal
          and thermoelectric totals match the official yearbook to the decimal, while the API's hydro series
          excludes pure pumped storage and its older photovoltaic figures are lower than the revised yearbook.
        </p>
      </div>
    </section>
  );
}
