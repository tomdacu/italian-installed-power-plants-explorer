import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 p-10 text-center", className)}>
      <div className="rounded-2xl border border-ink-200/70 bg-ink-50 p-3.5 text-ink-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-ink-500">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="font-display text-base font-semibold text-ink-800 dark:text-ink-100">{title}</p>
        {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
      {message}
    </div>
  );
}
