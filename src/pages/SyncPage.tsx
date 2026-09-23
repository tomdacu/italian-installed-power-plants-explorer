import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  CalendarDays,
  Database,
  DownloadCloud,
  Info,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useAvailability, useCredentialStatus, useMetadata } from "@/hooks/useMetadata";
import { useSyncJob } from "@/hooks/useSyncJob";
import { JobStatusPanel } from "@/components/sync/JobStatusPanel";
import { Section } from "@/components/sync/Section";
import { StoredDataOverview } from "@/components/sync/StoredDataOverview";
import { cn } from "@/lib/utils";
import { ALL_DATASETS } from "@/lib/constants";
import { resolveYearWindow } from "@/lib/year-bounds";

export function SyncPage() {
  const toast = useToast();
  const creds = useCredentialStatus();
  const meta = useMetadata();
  const availability = useAvailability();
  const sync = useSyncJob();

  // The default range is what Terna can actually serve: from the first
  // published year (2000) to the last year present in the local cache. The
  // server publishes the same limits, so UI and API cannot drift apart; while
  // the availability cache is empty the range stops at last year, never at the
  // current one — Terna has not published it yet.
  // I tre limiti che questa pagina e il pannello filtri derivano allo stesso
  // modo dal metadata vivono in `src/lib/year-bounds.ts`.
  const { firstYear, currentYear, fallbackLastYear } = resolveYearWindow(meta.data);
  const firstStored = availability.data?.datasets.renewable_source_capacity?.year_min ?? null;
  // The latest year Terna has published for any dataset: proposing 2025 or
  // 2026 would only queue steps with nothing to download. `null` means the
  // cache cannot tell us anything — a first start.
  const lastPublished = ALL_DATASETS.reduce<number | null>((max, dataset) => {
    const yearMax = availability.data?.datasets[dataset]?.year_max ?? null;
    return yearMax != null && (max === null || yearMax > max) ? yearMax : max;
  }, null);
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");
  // Un campo toccato non va più riscritto dai default. I due flag sono
  // separati: chi digita solo "From" deve comunque ricevere la correzione di
  // "To" quando l'availability risponde (era un unico flag, e il secondo campo
  // restava per sempre sul valore provvisorio).
  const fromEdited = useRef(false);
  const toEdited = useRef(false);

  useEffect(() => {
    if (fromEdited.current) return;
    setYearFrom(String(firstStored ?? firstYear));
  }, [firstStored, firstYear]);

  useEffect(() => {
    if (toEdited.current) return;
    // Con la cache vuota non sappiamo cosa Terna abbia pubblicato: l'anno
    // corrente non è ancora uscito, quindi si propone il precedente.
    setYearTo(String(lastPublished ?? fallbackLastYear));
  }, [lastPublished, fallbackLastYear]);

  const startSync = async () => {
    // `busy` è la stessa condizione che spegne i bottoni: guardia e `disabled`
    // non possono divergere.
    if (sync.busy) return;
    if (!creds.data?.configured) {
      toast.error("Configure credentials first", "Add your Terna keys in the Credentials page.");
      return;
    }
    let from = Number(yearFrom);
    let to = Number(yearTo);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      toast.warning("Invalid years", "Enter valid start and end years.");
      return;
    }
    // Stessi limiti del server (`clampYears`): sotto il 2000 Terna non pubblica,
    // sopra l'anno corrente non esiste ancora nulla.
    from = Math.max(firstYear, Math.min(currentYear, from));
    to = Math.max(firstYear, Math.min(currentYear, to));
    const [safeFrom, safeTo] = from <= to ? [from, to] : [to, from];
    fromEdited.current = true;
    toEdited.current = true;
    setYearFrom(String(safeFrom));
    setYearTo(String(safeTo));
    const years = Array.from({ length: safeTo - safeFrom + 1 }, (_, i) => safeFrom + i);

    await sync.start({ years, datasets: ALL_DATASETS });
  };

  const job = sync.job;
  const startingUp = sync.starting && !job;

  return (
    <div>
      <Topbar
        title="Data sync"
        subtitle="Download all Terna capacity data, then explore it on the dashboard"
        actions={
          <Button variant="primary" className="h-9" onClick={startSync} loading={sync.starting} disabled={sync.busy}>
            <RefreshCw className={cn("h-4 w-4", sync.polling && "animate-spin")} /> Download everything
          </Button>
        }
      />
      <div className="mx-auto max-w-[1400px] animate-fade-in p-6 pt-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Section
              icon={CalendarDays}
              title="Years"
              description="Every year in the range is downloaded for all datasets."
            >
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label="From"
                  type="number"
                  value={yearFrom}
                  onChange={(e) => {
                    fromEdited.current = true;
                    setYearFrom(e.target.value);
                  }}
                  className="h-9 max-w-[140px]"
                />
                <Input
                  label="To"
                  type="number"
                  value={yearTo}
                  onChange={(e) => {
                    toEdited.current = true;
                    setYearTo(e.target.value);
                  }}
                  className="h-9 max-w-[140px]"
                />
                <Button variant="outline" size="sm" className="h-9" onClick={startSync} loading={sync.starting} disabled={sync.busy}>
                  <DownloadCloud className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  One request per dataset and year brings back every source and both capacity
                  types (Lorda/Netta) — a full multi-year sync is only a few MB. You pick what to
                  look at on the dashboard. Note: national installed capacity is only published from
                  2021 onwards, so those earlier years are skipped for that dataset.
                </span>
              </p>
              {/* "Nothing is cached yet" è un'affermazione sulla cache: si può
                  fare solo dopo una risposta riuscita e con la cache davvero
                  vuota. In caricamento o in errore non sappiamo niente, e la
                  nota restava lì mentre il database aveva 68k righe (o
                  lampeggiava per il tempo della richiesta). */}
              {availability.isSuccess && lastPublished === null && (
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Nothing is cached yet, so the range ends at {currentYear - 1} rather than{" "}
                    {currentYear}: years Terna has not published yet come back empty and are reported
                    as such once the sync ends.
                  </span>
                </p>
              )}
            </Section>

            <Section
              icon={Database}
              title="What is stored locally"
              description="Per dataset and year, from your local database."
            >
              {availability.isLoading ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">Loading…</p>
              ) : availability.isError ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Could not reach the local data service. It keeps retrying on its own, so give it
                  a few seconds — downloading now would fail for the same reason.
                </p>
              ) : !availability.data || availability.data.total_rows === 0 ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Nothing stored yet. Press “Download everything” to fetch the data from Terna.
                </p>
              ) : (
                <StoredDataOverview availability={availability.data} datasets={ALL_DATASETS} />
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <JobStatusPanel
              job={job}
              startingUp={startingUp}
              running={sync.running}
              cancelling={sync.cancelling}
              connectionLost={sync.connectionLost}
              onCancel={() => void sync.cancel()}
              onReconnect={sync.reconnect}
            />

            <section className="card p-5">
              <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                <span className="font-semibold text-ink-800 dark:text-ink-100">Tip.</span> Each year
                needs one request per dataset, paced at about one per second to stay inside Terna&apos;s
                limits: four years of everything takes roughly half a minute. Keep the app open while
                it runs — you can explore previously synced data on the dashboard in the meantime.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
