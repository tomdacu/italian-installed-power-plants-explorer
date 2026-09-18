import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

export function LoadingOverlay({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3 text-ink-500 dark:text-ink-400">
      <Spinner className="h-6 w-6 text-brand-500" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
