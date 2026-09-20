import {
  ClipboardCopy,
  FileSpreadsheet,
  ImageDown,
  Download,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "./Button";
import { useToast } from "./Toast";
import { copyBlobToClipboardPng, downloadBlob, downloadString } from "@/lib/utils";
import { toCsv, type CsvSource, type CsvTable } from "@/lib/csv";

/**
 * Charts are drawn on the app surface, which is dark in dark mode: exporting the
 * SVG as it is produces light text and grid lines that vanish on the white
 * background of the exported image. These rules re-ink the whole plot for paper
 * without touching the series palette.
 */
const EXPORT_STYLE = `<style>
  text, tspan { fill: #374151 !important; }
  .recharts-cartesian-grid line { stroke: #e5e7eb !important; }
  .recharts-cartesian-axis-line, .recharts-cartesian-axis-tick-line { stroke: #d1d5db !important; }
  .recharts-reference-line line { stroke: #9ca3af !important; }
  .recharts-tooltip-cursor { display: none !important; }
</style>`;

function prepareClone(svg: SVGSVGElement, width: number, height: number): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.insertAdjacentHTML("afterbegin", EXPORT_STYLE);
  return clone;
}

function svgElementToBlob(svg: SVGSVGElement): Promise<Blob> {
  const width = svg.clientWidth || svg.viewBox.baseVal.width || 800;
  const height = svg.clientHeight || svg.viewBox.baseVal.height || 400;
  const clone = prepareClone(svg, width, height);
  const data = new XMLSerializer().serializeToString(clone);
  const svgString = '<?xml version="1.0" standalone="no"?>\r\n' + data;
  return Promise.resolve(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
}

async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const width =
    svg.viewBox.baseVal.width ||
    svg.clientWidth ||
    svg.parentElement?.clientWidth ||
    800;
  const height =
    svg.viewBox.baseVal.height ||
    svg.clientHeight ||
    svg.parentElement?.clientHeight ||
    400;

  const serializer = new XMLSerializer();
  const clone = prepareClone(svg, width, height);
  const svgString = serializer.serializeToString(clone);
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);

  return await new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width * scale);
      canvas.height = Math.max(1, height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      // Always on white: the image ends up in documents and slides, and a
      // transparent or theme-coloured background is unusable there.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode PNG"));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to load chart for export"));
    img.src = svgUrl;
  });
}

export interface ChartExportProps {
  containerRef: React.RefObject<HTMLElement | null>;
  filename?: string;
  /** The chart's own series, so each CSV carries that chart's data. */
  csv?: CsvSource;
}

export function ChartExportBar({ containerRef, filename = "chart", csv }: ChartExportProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const findSvg = useCallback((): SVGSVGElement | null => {
    const el = containerRef.current;
    if (!el) return null;
    const svg = el.querySelector("svg.recharts-surface, svg");
    return (svg as SVGSVGElement | null) ?? null;
  }, [containerRef]);

  const copyPng = useCallback(async () => {
    const svg = findSvg();
    if (!svg) return toast.error("Chart not ready", "Wait for the data to load, then try again.");
    try {
      setBusy("copy");
      const blob = await svgToPngBlob(svg);
      await copyBlobToClipboardPng(blob);
      toast.success("Chart copied", "Paste it into PowerPoint or Word with Ctrl+V");
    } catch (e) {
      toast.error("Copy failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [findSvg, toast]);

  const savePng = useCallback(async () => {
    const svg = findSvg();
    if (!svg) return toast.error("Chart not ready", "Wait for the data to load, then try again.");
    try {
      setBusy("png");
      const blob = await svgToPngBlob(svg);
      downloadBlob(blob, `${filename}.png`, "image/png");
      toast.success("Saved PNG", `${filename}.png is in your downloads`);
    } catch (e) {
      toast.error("Export failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [findSvg, filename, toast]);

  const saveSvg = useCallback(async () => {
    const svg = findSvg();
    if (!svg) return toast.error("Chart not ready", "Wait for the data to load, then try again.");
    try {
      setBusy("svg");
      const blob = await svgElementToBlob(svg);
      downloadBlob(blob, `${filename}.svg`, "image/svg+xml");
      toast.success("Saved SVG", `${filename}.svg is in your downloads`);
    } catch (e) {
      toast.error("Export failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [findSvg, filename, toast]);

  const saveCsv = useCallback(() => {
    const table: CsvTable | null = typeof csv === "function" ? csv() : (csv ?? null);
    if (!table || table.rows.length === 0) {
      toast.error("No data to export", "Load the chart, then try again.");
      return;
    }
    try {
      setBusy("csv");
      downloadString(toCsv(table), `${filename}.csv`, "text/csv;charset=utf-8");
      toast.success("CSV downloaded", `${filename}.csv is in your downloads`);
    } catch (e) {
      toast.error("CSV export failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [csv, filename, toast]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" onClick={copyPng} loading={busy === "copy"} title="Copy chart as PNG">
        <ClipboardCopy className="h-3.5 w-3.5" /> Copy PNG
      </Button>
      <Button variant="ghost" size="sm" onClick={savePng} loading={busy === "png"} title="Save chart as PNG">
        <ImageDown className="h-3.5 w-3.5" /> PNG
      </Button>
      <Button variant="ghost" size="sm" onClick={saveSvg} loading={busy === "svg"} title="Save chart as SVG">
        <Download className="h-3.5 w-3.5" /> SVG
      </Button>
      {csv && (
        <Button
          variant="subtle"
          size="sm"
          onClick={saveCsv}
          loading={busy === "csv"}
          title="Download this chart's data as CSV"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
        </Button>
      )}
    </div>
  );
}
