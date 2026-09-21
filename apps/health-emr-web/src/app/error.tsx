'use client';

/**
 * Route-level error boundary.
 *
 * Shows the digest, not the message: a server error can carry a column name or a
 * patient identifier, and rendering it to whoever triggered it is a disclosure.
 * The digest correlates to the server log, which is where the detail belongs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-5 text-center">
      <div>
        <h1 className="text-2xl font-medium">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--ar-text-muted)]">
          We could not load this page. Try again, and tell us the reference below if it persists.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-[var(--ar-text-faint)]">
            Reference {error.digest}
          </p>
        ) : null}
        <button
          onClick={reset}
          className="bg-[var(--ar-primary)] mt-6 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
