import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "danger" | "outline" | "subtle";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  // Dark ink on the brand gradient: white sat at 2,78:1 (brand-500) – 4,09:1
  // (brand-600), below WCAG AA. ink-950 reaches 6,80:1 and 4,62:1 on the same
  // stops, so the whole button — hover state included — stays above 4,5:1.
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-ink-950 shadow-sm ring-1 ring-inset ring-white/20 hover:from-brand-400 hover:to-brand-600 hover:shadow-glow focus-visible:ring-brand-500/50 disabled:from-brand-600/70 disabled:to-brand-600/70",
  outline:
    "border border-ink-200 bg-white text-ink-800 shadow-sm hover:border-ink-300 hover:bg-ink-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-100 dark:hover:bg-white/[0.08]",
  ghost:
    "text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/[0.06] dark:hover:text-white",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-500/40",
  subtle:
    "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-xl font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "active:scale-[.98]",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
