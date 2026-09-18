export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Terna Capacity Explorer">
      <defs>
        <linearGradient id="brandmark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fd98f" />
          <stop offset="1" stopColor="#076048" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#brandmark-g)" />
      <path
        d="M32 11 L53 49 H11 Z"
        fill="none"
        stroke="#fff"
        strokeOpacity=".92"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round">
        <line x1="23" y1="42" x2="23" y2="31" />
        <line x1="32" y1="42" x2="32" y2="21" />
        <line x1="41" y1="42" x2="41" y2="35" />
      </g>
    </svg>
  );
}
