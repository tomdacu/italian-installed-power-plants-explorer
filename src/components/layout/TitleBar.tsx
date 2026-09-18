import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { BrandMark } from "@/components/ui/BrandMark";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/**
 * Custom window chrome: replaces the native Windows title bar so the app
 * keeps its evergreen identity edge-to-edge. Renders drag region + window
 * controls; harmless (no controls) when running in a plain browser.
 */
export function TitleBar() {
  const [tauri] = useState(isTauri);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!tauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      const stop = await win.onResized(async () => {
        setMaximized(await win.isMaximized());
      });
      if (cancelled) stop();
      else unlisten = stop;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [tauri]);

  const control = (
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    danger = false,
  ) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-full w-12 shrink-0 place-items-center text-ink-400 transition-colors",
        danger
          ? "hover:bg-rose-500 hover:text-white"
          : "hover:bg-white/[0.08] hover:text-white",
      )}
    >
      {icon}
    </button>
  );

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-10 w-full shrink-0 items-center justify-between border-b border-white/[0.06] bg-forest-950 select-none"
    >
      {/* Ambient glow so the bar blends into the sidebar */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute -top-16 left-40 h-32 w-96 rounded-full bg-brand-500/10 blur-3xl" />
      </div>

      <div data-tauri-drag-region className="relative flex min-w-0 items-center gap-2.5 pl-3">
        <BrandMark className="h-5 w-5 rounded-md" />
        <span
          data-tauri-drag-region
          className="truncate font-display text-xs font-semibold tracking-wide text-ink-200"
        >
          Italian Capacity Explorer
        </span>
        <span
          data-tauri-drag-region
          className="hidden rounded-full border border-white/10 px-1.5 py-px font-mono text-[9px] text-ink-500 sm:inline"
        >
          v{APP_VERSION}
        </span>
      </div>

      {tauri && (
        <div className="relative flex h-full items-stretch">
          {control("Minimize", () => void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize()), <Minus className="h-3.5 w-3.5" />)}
          {control(
            maximized ? "Restore" : "Maximize",
            () => void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize()),
            maximized ? <Copy className="h-3 w-3 rotate-180" /> : <Square className="h-3 w-3" />,
          )}
          {control("Close", () => void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close()), <X className="h-4 w-4" />, true)}
        </div>
      )}
    </header>
  );
}
