import { useRef } from "react";
import { ChartExportBar } from "@/components/ui/ChartExportBar";
import type { CsvSource } from "@/lib/csv";

export function ChartCard({
  title,
  description,
  filename,
  csv,
  actions,
  className,
  children,
}: {
  title: string;
  description?: string;
  filename: string;
  /** The chart's own series: each card exports what it draws, not the whole dataset. */
  csv?: CsvSource;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <section className={`card overflow-hidden ${className ?? ""}`}>
      <div className="flex flex-col gap-3 p-5 pb-0">
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[15px] font-semibold text-ink-900 dark:text-white">
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p>
            )}
          </div>
          {actions}
        </div>
      </div>
      <div className="p-5 pb-3">
        <div ref={ref} className="w-full">
          {children}
        </div>
      </div>
      <div className="flex justify-end border-t border-ink-100 px-4 py-2.5 dark:border-white/[0.06]">
        <ChartExportBar containerRef={ref} filename={filename} csv={csv} />
      </div>
    </section>
  );
}
