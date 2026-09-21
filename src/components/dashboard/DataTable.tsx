import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Search, Inbox } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { api } from "@/api/client";
import { downloadString, formatGw, formatMw, formatNumber } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import type { CapacityRecord, RecordFilters } from "@/types";

type SortKey = keyof Pick<
  CapacityRecord,
  "year" | "region" | "province" | "source" | "capacity_type" | "efficient_power_mw" | "installed_capacity_gw" | "type"
>;
type Order = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "year", label: "Year" },
  { key: "region", label: "Region" },
  { key: "province", label: "Province" },
  { key: "source", label: "Source" },
  { key: "capacity_type", label: "Capacity" },
  { key: "type", label: "Type" },
  { key: "efficient_power_mw", label: "Eff. power (MW)" },
  { key: "installed_capacity_gw", label: "Inst. cap. (GW)" },
];

function rowKey(r: CapacityRecord, i: number): string {
  return [
    r.dataset,
    r.year,
    r.region,
    r.province,
    r.source,
    r.type,
    r.capacity_type,
    i,
  ].join("|");
}

function rowText(r: CapacityRecord): string {
  return [
    r.dataset,
    r.year,
    r.region,
    r.province,
    r.source,
    r.category,
    r.subcategory,
    r.type,
    r.capacity_type,
    r.efficient_power_mw,
    r.installed_capacity_gw,
  ]
    .filter((v) => v !== null && v !== undefined)
    .join(" ")
    .toLowerCase();
}

export function DataTable({ filters }: { filters: RecordFilters }) {
  const [sortKey, setSortKey] = useState<SortKey>("year");
  const [order, setOrder] = useState<Order>("desc");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
/** Righe caricate nella tabella: oltre questa soglia si dichiara il troncamento. */
const RECORD_PAGE_LIMIT = 20000;

  const recordsQuery = useQuery({
    queryKey: ["records", filters, sortKey, order],
    // 20.000 righe: oltre, l'ordinamento e la ricerca lato client diventano
    // pesanti. Il totale vero arriva insieme alla pagina, così la tabella può
    // dire quante righe restano fuori invece di far credere di averle tutte.
    // L'ordine va chiesto al server: se la selezione supera il limite, la
    // tabella deve mostrare le righe secondo il proprio ordinamento, non le
    // prime che il database restituisce.
    queryFn: () => api.recordsPage(filters, RECORD_PAGE_LIMIT, { column: sortKey, direction: order }),
  });

  const rows = recordsQuery.data?.rows ?? [];
  const totalRows = recordsQuery.data?.total ?? rows.length;
  const truncated = totalRows > rows.length;
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) list = rows.filter((r) => rowText(r).includes(q));
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? null;
      const bv = b[sortKey] ?? null;
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return order === "asc" ? av - bv : bv - av;
      }
      return order === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, query, sortKey, order]);

  // Client-side pagination keeps the DOM light even with tens of thousands of
  // records; filters or search changes jump back to the first page.
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [sorted, safePage],
  );
  useEffect(() => {
    setPage(0);
  }, [query, filters]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setOrder("asc");
    }
  };

  const exportVisibleCsv = () => {
    // Esporta quello che la tabella ha caricato: se la selezione è troncata lo
    // dice il messaggio sotto, e "Export all CSV" in alto esporta tutto.
    const fields = COLUMNS.map((c) => c.key);
    const rows = sorted.map((record) => {
      const row: Record<string, unknown> = { dataset: record.dataset };
      for (const field of fields) row[field] = record[field];
      row.fetched_at = record.fetched_at;
      return row;
    });
    downloadString(
      // Stesso serializzatore degli altri export: quoting coerente e BOM UTF-8
      // (senza, Excel legge male i nomi con accenti: "Forlì-Cesena").
      toCsv({
        columns: [
          { key: "dataset", label: "dataset" },
          ...fields.map((field) => ({ key: field as string, label: field as string })),
          { key: "fetched_at", label: "fetched_at" },
        ],
        rows,
      }),
      "capacity-records-view.csv",
      "text/csv;charset=utf-8",
    );
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-5 dark:border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <h3 className="font-display text-base font-semibold text-ink-900 dark:text-white">
            Capacity records
          </h3>
          <span className="chip border-ink-200/80 text-ink-500 dark:border-white/10 dark:text-ink-400">
            {truncated
              ? `${formatNumber(sorted.length)} of ${formatNumber(totalRows)} rows`
              : `${formatNumber(sorted.length)} rows`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            leading={<Search className="h-4 w-4" />}
            placeholder="Search rows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-56 text-sm"
            aria-label="Search records"
          />
          <Button variant="outline" size="sm" className="h-9" onClick={exportVisibleCsv}>
            <Download className="h-3.5 w-3.5" /> Export filtered
          </Button>
        </div>
      </div>

      <div className="max-h-[460px] overflow-auto">
        {recordsQuery.isLoading ? (
          <LoadingOverlay label="Loading records" />
        ) : recordsQuery.isError ? (
          <EmptyState
            icon={ArrowUpDown}
            title="Could not load records"
            description={(recordsQuery.error as Error).message}
          />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No matching records"
            description="Try widening the filters or running a data sync."
          />
        ) : (
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-50/95 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 backdrop-blur dark:bg-ink-900/95 dark:text-ink-400">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    // Lo stato di ordinamento va annunciato, non solo colorato.
                    aria-sort={sortKey === c.key ? (order === "asc" ? "ascending" : "descending") : "none"}
                    className="px-4 py-2.5 font-semibold"
                  >
                    <button
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 transition hover:text-ink-800 dark:hover:text-white"
                    >
                      {c.label}
                      {sortKey === c.key ? (
                        order === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-brand-500" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-brand-500" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-35" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr
                  key={rowKey(r, i)}
                  className="border-t border-ink-100/80 transition-colors last:border-b hover:bg-brand-50/50 dark:border-white/[0.05] dark:hover:bg-brand-500/[0.06]"
                >
                  <td className="px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{r.year}</td>
                  <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.region ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.province ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.source ?? r.type ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.capacity_type ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.type ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink-800 dark:text-ink-100">
                    {formatMw(r.efficient_power_mw)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink-800 dark:text-ink-100">
                    {formatGw(r.installed_capacity_gw)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {truncated && (
        <p className="flex flex-wrap items-center gap-1.5 border-t border-amber-300/60 bg-amber-50/70 px-4 py-2 text-xs text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          Showing {formatNumber(rows.length)} of {formatNumber(totalRows)} matching rows — narrow the
          filters to see the rest, or use <span className="font-medium">Export all CSV</span> for the
          full selection.
        </p>
      )}
      {sorted.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-2.5 text-xs text-ink-500 dark:border-white/[0.06] dark:text-ink-400">
          <span>
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of{" "}
            {formatNumber(sorted.length)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              Previous
            </Button>
            <span className="px-1 font-mono">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
