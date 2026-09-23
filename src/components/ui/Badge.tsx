import { cn } from "@/lib/utils";

type Variant = "neutral" | "brand" | "amber" | "rose" | "success";

const VARIANTS: Record<Variant, string> = {
  neutral: "border-transparent bg-ink-100 text-ink-700 dark:bg-white/[0.07] dark:text-ink-200",
  brand: "border-transparent bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
  amber: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "border-transparent bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  success: "border-transparent bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
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
