import { useId } from "react";

export function BrandMark({ className }: { className?: string }) {
  // Il marchio sta in più punti della stessa pagina (rail e barra del titolo):
  // con un id fisso il gradiente finiva due volte nel documento e `url(#…)`
  // puntava al primo. `useId` dà a ogni istanza il proprio; i due punti che
  // React ci mette dentro non sono validi in un id CSS, quindi si tolgono.
  const gradientId = `brandmark-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 1024 1024" className={className} role="img" aria-label="Italian Renewable Capacity Explorer">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fd98f" />
          <stop offset="1" stopColor="#076048" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="230" fill={`url(#${gradientId})`} />
      <g fill="#fff">
        <rect x="240" y="530" width="152" height="288" rx="76" />
        <rect x="436" y="374" width="152" height="444" rx="76" />
        <rect x="632" y="206" width="152" height="612" rx="76" />
      </g>
    </svg>
  );
}
