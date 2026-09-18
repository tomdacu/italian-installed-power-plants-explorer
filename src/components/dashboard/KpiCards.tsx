import type { LucideIcon } from "lucide-react";
import { CalendarDays, Layers, TrendingUp } from "lucide-react";
import { compactMw, formatGw, formatMw, formatNumber } from "@/lib/utils";
import type { Summary } from "@/types";

interface KpiProps {
  label: string;
  value?: string;
  hint?: string;
  icon: LucideIcon;
  accent: string;
  glow: string;
  loading?: boolean;
}

function Kpi({ label, value, hint, icon: Icon, accent, glow, loading }: KpiProps) {
  return (
    <div className="card card-hover relative overflow-hidden p-5">
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl ${glow}`}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-ink-400">
            {label}
          </p>
          {loading ? (
            <div className="mt-2.5 space-y-2">
              <div className="skeleton h-7 w-28" />
              <div className="skeleton h-3.5 w-40" />
            </div>
          ) : (
            <>
              <p className="mt-1.5 font-display text-[26px] font-semibold leading-none tracking-tight text-ink-900 dark:text-white">
                {value}
              </p>
              {hint && <p className="mt-2 text-xs leading-snug text-ink-500 dark:text-ink-400">{hint}</p>}
            </>
          )}
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-card ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function formatSigned(value: number, unit: string, digits = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${sign}${abs} ${unit}`;
}

export function KpiCards({
  summary,
  loading,
  isGw,
}: {
  summary: Summary | undefined;
  loading: boolean;
  isGw?: boolean;
}) {
  if (isGw) {
    const total = summary?.latest_total_installed_capacity_gw ?? null;
    const noData = !loading && (summary == null || total === null);
    const yoy = summary?.yoy_new_gw ?? null;
    const yoyPct = summary?.yoy_pct ?? null;
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          label="Installed stock"
          value={loading ? undefined : total === null ? "—" : `${formatGw(total)} GW`}
          hint={
            loading
              ? undefined
              : noData
                ? "No records in the current selection"
                : `National stock in ${summary?.latest_year} · by type`
          }
          icon={TrendingUp}
          accent="bg-gradient-to-br from-brand-400 to-brand-700"
          glow="bg-brand-500/20"
          loading={loading}
        />
        <Kpi
          label="Added vs previous year"
          value={loading ? undefined : yoy === null ? "—" : formatSigned(yoy, "GW", 2)}
          hint={
            loading || summary?.previous_year == null
              ? undefined
              : `${summary.previous_year} → ${summary.latest_year}${yoyPct !== null ? ` (${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(1)}%)` : ""}`
          }
          icon={TrendingUp}
          accent="bg-gradient-to-br from-sky-400 to-sky-700"
          glow="bg-sky-500/20"
          loading={loading}
        />
        <Kpi
          label="Year range"
          value={
            !summary?.year_min
              ? "—"
              : `${summary.year_min} – ${summary.year_max ?? summary.year_min}`
          }
          hint={
            summary?.latest_year ? `Latest data: ${summary.latest_year} · ${formatNumber(summary.row_count)} rows` : "Earliest to latest year in stored data"
          }
          icon={CalendarDays}
          accent="bg-gradient-to-br from-violet-400 to-violet-700"
          glow="bg-violet-500/20"
          loading={loading}
        />
      </div>
    );
  }

  const total = summary?.latest_total_efficient_power_mw ?? null;
  const noData = !loading && (summary == null || total === null);
  const yoy = summary?.yoy_new_mw ?? null;
  const yoyPct = summary?.yoy_pct ?? null;
  const capLabel = summary?.capacity_type_applied ?? "Lorda";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Kpi
        label={`Installed stock · ${capLabel}`}
        value={loading ? undefined : total === null ? "—" : compactMw(total)}
        hint={
          loading
            ? undefined
            : noData
              ? "No records in the current selection"
              : `${formatMw(total)} MW in ${summary?.latest_year} · single ${capLabel} index`
        }
        icon={TrendingUp}
        accent="bg-gradient-to-br from-brand-400 to-brand-700"
        glow="bg-brand-500/20"
        loading={loading}
      />
      <Kpi
        label="Added vs previous year"
        value={loading ? undefined : yoy === null ? "—" : formatSigned(yoy, "MW")}
        hint={
          loading || summary?.previous_year == null
            ? undefined
            : `${summary.previous_year} → ${summary.latest_year}${yoyPct !== null ? ` (${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(1)}%)` : ""}`
        }
        icon={Layers}
        accent="bg-gradient-to-br from-sky-400 to-sky-700"
        glow="bg-sky-500/20"
        loading={loading}
      />
      <Kpi
        label="Year range"
        value={
          !summary?.year_min
            ? "—"
            : `${summary.year_min} – ${summary.year_max ?? summary.year_min}`
        }
        hint={
          summary?.latest_year ? `Latest data: ${summary.latest_year} · ${formatNumber(summary.row_count)} rows` : "Earliest to latest year in stored data"
        }
        icon={CalendarDays}
        accent="bg-gradient-to-br from-violet-400 to-violet-700"
        glow="bg-violet-500/20"
        loading={loading}
      />
    </div>
  );
}
