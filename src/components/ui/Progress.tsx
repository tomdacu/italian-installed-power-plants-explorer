import { cn } from "@/lib/utils";

export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value: number;
  max?: number;
  /** Nome accessibile: `role="progressbar"` senza nome e' una violazione axe. */
  label: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-ink-200/80 dark:bg-white/[0.08]", className)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
