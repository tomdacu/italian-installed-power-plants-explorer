import { useDeferredValue, useEffect, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Search, Inbox } from "lucide-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingOverlay } from "@/components/ui/Spinner";
import { api } from "@/api/client";
import { formatGw, formatMw, formatNumber } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
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

const PAGE_SIZE = 50;

function rowKey(record: CapacityRecord, index: number): string {
  return [
    record.dataset,
    record.year,
    record.region,
    record.province,
    record.source,
    record.type,
    record.capacity_type,
    index,
  ].join("|");
}

/**
 * Tabella dei record con paginazione, ricerca e ordinamento **sul server**: la
 * pagina che si vede è quella che si chiede. Prima scaricava 20.000 righe (oltre
 * 3 MB) per mostrarne cinquanta.
 */
export function DataTable({ filters, resetToken = 0 }: { filters: RecordFilters; resetToken?: number }) {
  const [sortKey, setSortKey] = useState<SortKey>("year");
  const [order, setOrder] = useState<Order>("desc");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const toast = useToast();

  // La ricerca parte dopo che l'utente smette di scrivere: `useDeferredValue`
  // tiene l'input reattivo mentre la query viaggia.
  const search = useDeferredValue(query).trim();
  const recordsQuery = useQuery({
    queryKey: ["records", filters, search, sortKey, order, page],
    queryFn: () =>
      api.recordsPage(filters, PAGE_SIZE, page * PAGE_SIZE, {
        column: sortKey,
        direction: order,
        q: search,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = recordsQuery.data?.rows ?? [];
  const totalRows = recordsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const firstRow = totalRows === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const lastRow = Math.min((safePage + 1) * PAGE_SIZE, totalRows);
  const searching = search.length > 0;

  useEffect(() => {
    setPage(0);
  }, [search, filters]);

  // Il Reset della dashboard azzera anche ricerca e ordinamento: sono stato
  // locale della tabella, ma l'utente se li aspetta azzerati.
  useEffect(() => {
    setQuery("");
    setSortKey("year");
    setOrder("desc");
    setPage(0);
  }, [resetToken]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey && order === "desc") setOrder("asc");
    else if (key === sortKey) setOrder("desc");
    else {
      setSortKey(key);
      setOrder("desc");
    }
    setPage(0);
  };

  const exportFilteredCsv = async () => {
    try {
      // Il server esporta tutto ciò che corrisponde ai filtri e alla ricerca:
      // la pagina in memoria non è la selezione.
      const text = await api.exportCsv({ ...filters, q: search });
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `capacity-records-${stamp}.csv`;
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("CSV downloaded", `${name} is in your downloads`);
    } catch (error) {
      toast.error("Export failed", (error as Error).message);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-5 dark:border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <h3 className="font-display text-base font-semibold text-ink-900 dark:text-white">
            Capacity records
          </h3>
          <span className="chip border-ink-200/80 text-ink-500 dark:border-white/10 dark:text-ink-400">
            {formatNumber(totalRows)} {searching ? "matching" : ""} rows
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rows…"
              className="h-9 w-[220px] pl-8"
              aria-label="Search rows"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={() => void exportFilteredCsv()}>
            <Download className="h-3.5 w-3.5" /> Export filtered
          </Button>
        </div>
      </div>

      {recordsQuery.isLoading ? (
        <LoadingOverlay label="Loading records" />
      ) : recordsQuery.isError ? (
        <div className="p-6">
          <EmptyState
            icon={Inbox}
            title="Could not load the records"
            description={(recordsQuery.error as Error).message}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={Inbox}
            title="No matching records"
            description={
              searching
                ? "Nothing matches the search — clear it or try different words."
                : "Try widening the filters or running a data sync."
            }
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-ink-50/95 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 backdrop-blur dark:bg-ink-900/95 dark:text-ink-400">
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      // Lo stato di ordinamento va annunciato, non solo colorato.
                      aria-sort={sortKey === column.key ? (order === "asc" ? "ascending" : "descending") : "none"}
                      className="px-4 py-2.5 font-semibold"
                    >
                      <button
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 transition hover:text-ink-800 dark:hover:text-white"
                      >
                        {column.label}
                        {sortKey === column.key ? (
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
                {rows.map((record, index) => (
                  <tr
                    key={rowKey(record, index)}
                    className="border-t border-ink-100/80 transition-colors last:border-b hover:bg-brand-50/50 dark:border-white/[0.05] dark:hover:bg-brand-500/[0.06]"
                  >
                    <td className="px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{record.year}</td>
                    <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{record.region ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{record.province ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{record.source ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{record.capacity_type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{record.type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink-800 dark:text-ink-100">
                      {formatMw(record.efficient_power_mw)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink-800 dark:text-ink-100">
                      {formatGw(record.installed_capacity_gw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-2.5 text-xs text-ink-500 dark:border-white/[0.06] dark:text-ink-400">
            <span>
              {formatNumber(firstRow)}–{formatNumber(lastRow)} of {formatNumber(totalRows)}
              {searching ? " matching rows" : " rows"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage === 0}
                onClick={() => setPage(Math.max(0, safePage - 1))}
              >
                Previous
              </Button>
              <span className="px-1 font-mono text-[11px]">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
