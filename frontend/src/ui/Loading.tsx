/** What a page shows while its data arrives: the shape of the page, softly pulsing, so nothing
 *  jumps when the real content lands. The words are for screen readers. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="page-narrow" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="animate-pulse space-y-5">
        <div className="h-8 w-1/3 rounded-lg bg-line" />
        <div className="h-4 w-2/3 rounded bg-line" />
        <div className="h-32 rounded-2xl bg-surface shadow-card" />
        <div className="h-24 rounded-2xl bg-surface shadow-card" />
      </div>
    </main>
  );
}

/** The same idea inside a page, for a list that is still loading. */
export function LoadingRows({ label = "Loading…" }: { label?: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="animate-pulse space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-surface shadow-card" />
        ))}
      </div>
    </div>
  );
}
