/**
 * What fills the gap while a page is being prepared.
 *
 * Next renders nothing for a route segment whose layout is still resolving, and
 * every console here has an async gate in its layout that reads the session. So
 * the first second after signing in was a blank white page — which reads as a
 * broken application rather than a loading one.
 *
 * Deliberately not a spinner in the middle of nothing. A shape that matches
 * what is about to arrive means the content appears *in place* rather than
 * pushing a spinner out of the way, and the page does not jump as each part
 * lands.
 */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[60vh] flex-col gap-6 px-4 py-6 md:px-8 md:py-8"
    >
      <span className="sr-only">{label}</span>

      {/* The page title. */}
      <div className="flex flex-col gap-2">
        <div className="ar-skeleton h-7 w-56" />
        <div className="ar-skeleton h-4 w-80" />
      </div>

      {/* The row of figures most consoles open with. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="ar-card flex flex-col gap-3 p-5">
            <div className="ar-skeleton h-3 w-24" />
            <div className="ar-skeleton h-7 w-20" />
          </div>
        ))}
      </div>

      {/* And the table or panel under them. */}
      <div className="ar-card flex flex-col gap-3 p-5">
        <div className="ar-skeleton h-4 w-40" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <div className="ar-skeleton h-4 flex-1" />
            <div className="ar-skeleton h-4 w-24" />
            <div className="ar-skeleton h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The whole window, for when even the shell is not up yet.
 *
 * Shown while a console's layout resolves — the moment right after signing in,
 * when there is no navigation on screen to put a skeleton inside.
 */
export function AppLoader() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-screen">
      <span className="sr-only">Signing you in</span>

      {/* Where the navigation is about to be. */}
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-[var(--ar-border)] bg-[var(--ar-card-bg)] p-4 md:flex">
        <div className="ar-skeleton h-8 w-36" />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="ar-skeleton h-8 w-full" />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-[var(--ar-border)] bg-[var(--ar-card-bg)] px-4 py-3 md:px-8">
          <div className="ar-skeleton h-4 w-40" />
          <div className="ml-auto ar-skeleton h-8 w-8 rounded-full" />
          <div className="ar-skeleton h-8 w-32" />
        </div>
        <PageLoader label="Loading your console" />
      </div>
    </div>
  );
}
