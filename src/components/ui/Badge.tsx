import { cn } from "@/lib/utils";

type Variant = "neutral" | "brand" | "amber" | "sky" | "rose" | "violet" | "success" | "outline";

const VARIANTS: Record<Variant, string> = {
  neutral: "border-transparent bg-ink-100 text-ink-700 dark:bg-white/[0.07] dark:text-ink-200",
  brand: "border-transparent bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
  amber: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  sky: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  rose: "border-transparent bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  violet: "border-transparent bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  success: "border-transparent bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
  outline: "border-ink-200 bg-transparent text-ink-700 dark:border-white/15 dark:text-ink-200",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn("chip", VARIANTS[variant], className)}>{children}</span>;
}
