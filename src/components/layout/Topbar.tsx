export function Topbar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="header-glass sticky top-0 z-20 flex items-center justify-between gap-4 px-8 py-5">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 truncate text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
