/**
 * Client-side API access.
 *
 * Everything goes through the BFF at /api/bff/* — never directly to the API —
 * so the access token stays in an httpOnly cookie and is attached server-side.
 * No token is ever readable by browser JavaScript.
 */
import { clearListCache } from './list-cache';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();

  /**
   * A body the browser knows how to type is left alone.
   *
   * `FormData` carries a multipart boundary that only the browser can generate,
   * and it lives in the Content-Type header. Declaring `application/json` over
   * the top of it leaves the far end parsing a multipart body as JSON — which
   * fails inside the framework's parser, so the symptom is a 500 rather than a
   * useful message. The same applies to a Blob or URLSearchParams.
   */
  const browserTypesIt =
    typeof FormData !== 'undefined' &&
    (init.body instanceof FormData ||
      init.body instanceof Blob ||
      init.body instanceof URLSearchParams);

  const response = await fetch(`/api/bff/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      ...(init.body && !browserTypesIt ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  });

  /**
   * A write invalidates every cached list.
   *
   * Here rather than at the call sites. Mutations happen in about twenty
   * components, each of which refreshes the screen its own way — `router.refresh()`,
   * a remount key, a local reload — and every one of them would have had to
   * remember to clear the cache too. One of them would not have, and a shipped
   * order would sit in the queue looking unshipped for half a minute.
   *
   * Coarse on purpose: working out which lists a write could have touched means
   * knowing that shipping an order changes the platform's visit list, the
   * client's prescription list and the stuck-order count. Emptying the lot
   * costs one refetch of whatever is on screen and cannot be wrong.
   */
  if (response.ok && method !== 'GET' && method !== 'HEAD') {
    clearListCache();
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      payload?.message ?? payload?.error ?? 'Request failed',
      response.status,
      payload?.details,
    );
  }

  return payload as T;
}
