import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function formatMw(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatGw(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function compactMw(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M MW`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k MW`;
  return `${formatMw(value)} MW`;
}

export const SOURCE_COLORS: Record<string, string> = {
  Fotovoltaico: "#f59e0b",
  Eolico: "#0ea5e9",
  Idrico: "#06b6d4",
  Idroelettrico: "#06b6d4",
  Bioenergie: "#84cc16",
  // Distinct from Termoelettrico: both appear in the generation-plants dataset.
  Geotermoelettrico: "#a855f7",
  Termoelettrico: "#ef4444",
};

export const DEFAULT_PALETTE = [
  "#16b07f",
  "#0ea5e9",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#84cc16",
  "#06b6d4",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export function colorFor(key: string, index: number): string {
  return SOURCE_COLORS[key] ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
}

export function downloadBlob(content: BlobPart, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadString(text: string, filename: string, mime = "text/plain") {
  downloadBlob(text, filename, mime);
}

export function copyBlobToClipboardPng(pngBlob: Blob): Promise<void> {
  const ClipboardItemCtor: typeof ClipboardItem | undefined =
    typeof ClipboardItem !== "undefined" ? ClipboardItem : undefined;
  if (!ClipboardItemCtor || !navigator.clipboard) {
    return Promise.reject(new Error("Clipboard not supported in this environment"));
  }
  const item = new ClipboardItemCtor({ "image/png": pngBlob });
  return navigator.clipboard.write([item]);
}