import { BrandMark } from "@/components/ui/BrandMark";
import { APP_VERSION } from "@/lib/version";

/**
 * Application header. The app runs in a browser window — or as an installed app
 * — so the window controls belong to the browser: here only identity and version.
 */
export function TitleBar() {
  return (
    <header className="relative z-40 flex h-10 w-full shrink-0 items-center justify-between border-b border-white/[0.06] bg-forest-950 select-none">
      {/* Ambient glow so the bar blends into the sidebar */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-16 left-40 h-32 w-96 rounded-full bg-brand-500/10 blur-3xl" />
      </div>

      <div className="relative flex min-w-0 items-center gap-2.5 pl-3">
        <BrandMark className="h-5 w-5 rounded-md" />
        <span className="truncate font-display text-xs font-semibold tracking-wide text-ink-200">
          Italian Capacity Explorer
        </span>
        <span className="hidden rounded-full border border-white/10 px-1.5 py-px font-mono text-[9px] text-ink-500 sm:inline">
          v{APP_VERSION}
        </span>
      </div>
    </header>
  );
}
