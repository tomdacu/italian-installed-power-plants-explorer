import { BrandMark } from "./BrandMark";

export function Splash() {
  return (
    <div className="app-bg grid min-h-full place-items-center">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="animate-float-slow">
          <BrandMark className="h-16 w-16 rounded-2xl shadow-glow" />
        </div>
        <p className="font-display text-sm font-medium text-ink-500 dark:text-ink-400">Preparing your workspace…</p>
      </div>
    </div>
  );
}
