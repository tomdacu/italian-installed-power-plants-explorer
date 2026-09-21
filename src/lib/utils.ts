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

/** Valore compatto con l'unità leggibile: 74.508,7 MW → "74.51 GW". */
export function compactMw(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000) return `${formatGw(value / 1_000)} GW`;
  return `${formatMw(value)} MW`;
}

export const SOURCE_COLORS: Record<string, string> = {
  Fotovoltaico: "#f59e0b",
  // Blu pieno per l'idrico e verde-azzurro per l'eolico: prima erano due ciano
  // quasi identici, e nelle barre impilate non si distinguevano.
  Idrico: "#2563eb",
  Idroelettrico: "#2563eb",
  Eolico: "#14b8a6",
  // Oliva: sta fra il verde e il marrone, e non si confonde né con il verde
  // dell'idrico né con l'ambra del fotovoltaico.
  Bioenergie: "#a3ac39",
  // Distinto da Termoelettrico: entrambi compaiono nel dataset generation-plants.
  Geotermoelettrico: "#a855f7",
  Termoelettrico: "#ef4444",
};

/** Tinte per le dimensioni che non sono fonti (categoria, sottocategoria). */
export const DEFAULT_PALETTE = [
  "#6366f1",
  "#ec4899",
  "#f97316",
  "#64748b",
  "#22d3ee",
  "#d946ef",
  "#0d9488",
  "#facc15",
  "#94a3b8",
  "#fb7185",
];

// Il dataset nazionale è un'altra misura (GW invece di MW): famiglia a parte.
export const INSTALLED_CAPACITY_PALETTE = [
  "#0a8f66",
  "#14b07f",
  "#2fd98f",
  "#71e2b5",
  "#076048",
];

export function colorFor(key: string, index: number, dataset?: string): string {
  if (dataset === "installed_capacity") {
    return INSTALLED_CAPACITY_PALETTE[index % INSTALLED_CAPACITY_PALETTE.length];
  }
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
  // Revoking immediately can cancel the download before the browser has read
  // the blob — keep the URL alive for a while, then release it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
