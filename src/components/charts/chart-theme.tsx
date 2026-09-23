/**
 * Props Recharts condivise dai quattro grafici.
 *
 * Assi, griglia, cursore del tooltip e legenda erano ricopiati in ogni
 * componente: gli stessi colori e le stesse classi ripetuti a mano. Qui stanno
 * una volta sola, con i valori identici a quelli di prima — nessuna resa è
 * cambiata, cambia solo dove sono scritti.
 *
 * Il tick ha due misure: 11px ovunque, 10.5px sull'asse Y delle aree (che è
 * più stretto e porta etichette lunghe).
 */
import type { SVGProps } from "react";
import type { CartesianGridProps, LegendProps } from "recharts";

/** Assi: linea nascosta, tick nascosto, testo in ink leggibile su chiaro e scuro. */
export const axisProps = {
  stroke: "currentColor",
  className: "text-ink-500 dark:text-ink-400",
  axisLine: false,
  tickLine: false,
};

export const axisTick = { fontSize: 11 };

export const axisTickSmall = { fontSize: 10.5 };

/** Riga di fondo condivisa dalle due griglie. */
const gridLineProps = {
  strokeDasharray: "4 4",
  stroke: "currentColor",
  className: "text-ink-200/60 dark:text-white/[0.06]",
};

/** Griglia delle barre verticali: solo linee orizzontali. */
export const gridHorizontal: CartesianGridProps = { ...gridLineProps, vertical: false };

/** Griglia delle barre orizzontali (`layout="vertical"`): solo linee verticali. */
export const gridVertical: CartesianGridProps = { ...gridLineProps, horizontal: false };

/**
 * Legenda: swatch del colore della serie, testo no — il giallo del fotovoltaico
 * su bianco sta a 2.15:1.
 */
export const legendProps: Pick<LegendProps, "iconType" | "iconSize" | "formatter"> = {
  iconType: "circle",
  iconSize: 8,
  formatter: (value) => <span className="text-ink-500 dark:text-ink-400">{value}</span>,
};

/** Cursore del tooltip: velo tenue sul fondo della barra attiva. */
export const tooltipCursor: SVGProps<SVGElement> = {
  fill: "currentColor",
  className: "text-ink-200/40 dark:text-white/[0.04]",
};
