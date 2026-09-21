import type { ListResponse } from '@health-emr/types';

/**
 * The last answer for each list query, and the requests still in the air.
 *
 * Module-level on purpose: the point is to survive a component unmounting, so
 * that leaving a tab and coming back shows the table you were just looking at
 * instead of a skeleton and a round-trip.
 *
 * It holds PHI, so it lives only in this tab's heap, is never written to
 * storage, expires in half a minute, and is emptied both on sign-out and on
 * every successful write.
 */
const CACHE = new Map<string, { at: number; body: ListResponse<unknown> }>();
const INFLIGHT = new Map<string, Promise<ListResponse<unknown>>>();

/** Long enough to make navigation feel instant, short enough to stay true. */
export const FRESH_MS = 30_000;

export function cached<T>(key: string): { at: number; body: ListResponse<T> } | undefined {
  return CACHE.get(key) as { at: number; body: ListResponse<T> } | undefined;
}

export function forget(key: string): void {
  CACHE.delete(key);
}

/**
 * Empties the cache.
 *
 * Called on sign-out, and after any request that changed something. A cached
 * list is a promise that nothing has moved since it was read, and a write is
 * exactly the event that breaks that promise.
 */
export function clearListCache(): void {
  CACHE.clear();
  INFLIGHT.clear();
}

/**
 * One request per key, however many callers ask for it.
 *
 * Two things produce duplicate calls for the same rows: React's development
 * double-mount, and two components on one screen reading the same list. Sharing
 * the promise collapses both into a single round-trip, and the second caller
 * gets the same answer rather than a second query against the database.
 */
export function loadList<T>(key: string, url: string): Promise<ListResponse<T>> {
  const existing = INFLIGHT.get(key);
  if (existing) return existing as Promise<ListResponse<T>>;

  const request = fetch(url, { cache: 'no-store' })
    .then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `Request failed (${response.status})`);
      return body as ListResponse<T>;
    })
    .then((body) => {
      CACHE.set(key, { at: Date.now(), body: body as ListResponse<unknown> });
      return body;
    })
    .finally(() => {
      INFLIGHT.delete(key);
    });

  INFLIGHT.set(key, request as Promise<ListResponse<unknown>>);
  return request;
}
