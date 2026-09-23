import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  RefreshCw,
  Settings,
  KeyRound,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useHealth } from "@/hooks/useMetadata";
import { BrandMark } from "@/components/ui/BrandMark";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";

const WORKSPACE = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sync", label: "Data sync", icon: RefreshCw },
];

const ACCOUNT = [
  { to: "/credentials", label: "Credentials", icon: KeyRound },
  { to: "/settings", label: "Settings", icon: Settings },
];

function BackendStatus() {
  const health = useHealth();
  const state = health.isLoading
    ? { label: "Starting", color: "bg-amber-400", pulse: true }
    : health.isError
      ? { label: "Backend offline", color: "bg-rose-400", pulse: false }
      : { label: "Local service online", color: "bg-emerald-400", pulse: false };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-ink-200/70 bg-ink-50 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
      <span className="relative flex h-2 w-2">
        {state.pulse && (
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", state.color)} />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", state.color)} />
      </span>
      <span className="truncate text-xs font-medium text-ink-600 dark:text-ink-400">{state.label}</span>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
          isActive
            ? "bg-brand-500/10 text-ink-900 dark:bg-white/[0.07] dark:text-white"
            : "text-ink-500 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.04] dark:hover:text-ink-100",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500 transition-all duration-200 dark:bg-brand-400",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-brand-600 dark:text-brand-400" : "group-hover:text-brand-600 dark:group-hover:text-brand-300")} />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function NavSection({ title, items }: { title: string; items: typeof WORKSPACE }) {
  return (
    <div>
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-ink-400">
        {title}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { theme, toggle } = useTheme();

  return (
    <aside className="relative flex h-full w-[248px] shrink-0 flex-col overflow-hidden border-r border-ink-200/70 bg-white dark:border-transparent dark:bg-forest-950">
      {/* Ambient brand glows — dark theme only: on white they would just wash out */}
      <div className="pointer-events-none absolute inset-0 hidden dark:block" aria-hidden>
        <div className="absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="absolute -bottom-28 -left-16 h-56 w-56 rounded-full bg-brand-700/20 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      <div className="relative flex items-center gap-3 px-5 pb-6 pt-6">
        <div className="animate-float-slow">
          <BrandMark className="h-10 w-10 rounded-xl shadow-glow" />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold leading-tight text-ink-900 dark:text-white">Italian Renewable</p>
          <p className="truncate text-[11px] font-medium tracking-wide text-brand-700 dark:text-brand-300/80">
            Capacity Explorer
          </p>
        </div>
      </div>

      <nav className="relative flex-1 space-y-6 overflow-y-auto px-3 py-1">
        <NavSection title="Workspace" items={WORKSPACE} />
        <NavSection title="Account" items={ACCOUNT} />
      </nav>

      <div className="relative space-y-2 border-t border-ink-200/70 p-3 dark:border-white/[0.06]">
        <BackendStatus />
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.05] dark:hover:text-ink-100"
        >
          <span className="flex items-center gap-2.5">
            {theme === "dark" ? <Sun className="h-4 w-4 text-brand-600 dark:text-brand-300" /> : <Moon className="h-4 w-4 text-brand-600 dark:text-brand-300" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">v{APP_VERSION}</span>
        </button>
      </div>
    </aside>
  );
}
