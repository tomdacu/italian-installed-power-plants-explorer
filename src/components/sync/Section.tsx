interface Props {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  /**
   * Slot a destra del titolo. Il pannello job ha **sempre** quel wrapper, anche
   * quando non ha un job da mostrare: per questo lo slot esiste appena la prop
   * è passata, e `null`/`false` significano «presente ma vuoto» — senza la
   * prop, l'intestazione resta quella compatta (nessun `<div>` in più).
   */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Il pannello che si ripete: card, icona, titolo, descrizione, contenuto.
 *
 * Due intestazioni, una per forma: compatta (icona e testo, come i pannelli
 * "Years" e "What is stored locally") e con lo slot delle azioni (come il
 * pannello del job). Sono le due che esistevano già: il markup di ciascuna è
 * quello di prima, riga per riga.
 */
export function Section({ icon: Icon, title, description, actions, children }: Props) {
  const heading = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h2 className="font-display text-sm font-semibold text-ink-900 dark:text-white">{title}</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">{description}</p>
      </div>
    </>
  );

  return (
    <section className="card p-5">
      {actions === undefined ? (
        <div className="mb-4 flex items-center gap-3">{heading}</div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">{heading}</div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
