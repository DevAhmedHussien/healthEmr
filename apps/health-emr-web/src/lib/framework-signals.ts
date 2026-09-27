/**
 * Next signals `redirect()` and `notFound()` by throwing.
 *
 * Which means a bare `.catch(() => null)` around a fetch swallows them. That is
 * how a page ends up rendering "not found" for somebody whose session had
 * expired: the redirect was raised, caught by a handler written for a missing
 * record, and turned into a 404.
 *
 * Kept apart from `server-api` so it can be tested on its own — that module
 * pulls in the whole auth stack the moment it is imported.
 */

/** A thrown value that is the framework's own control flow, not a failure. */
export function isFrameworkSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
  );
}

/**
 * A catch handler that falls back to `fallback`, but never eats a redirect.
 *
 *     serverApi<Visit>(`v1/admin/visits/${id}`).catch(swallow(null))
 */
export function swallow<T>(fallback: T): (error: unknown) => T {
  return (error: unknown) => {
    if (isFrameworkSignal(error)) throw error;
    return fallback;
  };
}
