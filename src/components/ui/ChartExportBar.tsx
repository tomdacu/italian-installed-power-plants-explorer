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
import { api } from "@/api/client";
import type { RecordFilters } from "@/types";

function svgElementToBlob(svg: SVGSVGElement): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("width") && svg.clientWidth) {
    clone.setAttribute("width", String(svg.clientWidth));
  }
  if (!clone.getAttribute("height") && svg.clientHeight) {
    clone.setAttribute("height", String(svg.clientHeight));
  }
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
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
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
      ctx.fillStyle = window.getComputedStyle(document.body).backgroundColor || "#ffffff";
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
  csvFilters?: RecordFilters;
}

export function ChartExportBar({ containerRef, filename = "chart", csvFilters }: ChartExportProps) {
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

  const saveCsv = useCallback(async () => {
    if (!csvFilters) return;
    try {
      setBusy("csv");
      const text = await api.exportCsv(csvFilters);
      downloadString(text, `${filename}.csv`, "text/csv;charset=utf-8");
      toast.success("CSV downloaded", `${filename}.csv is in your downloads`);
    } catch (e) {
      toast.error("CSV export failed", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [csvFilters, filename, toast]);

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
      {csvFilters && (
        <Button variant="subtle" size="sm" onClick={saveCsv} loading={busy === "csv"} title="Download source data as CSV">
          <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
        </Button>
      )}
    </div>
  );
}
