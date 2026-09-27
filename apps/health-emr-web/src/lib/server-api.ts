import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { loginWithReturn } from '@/lib/route-guard';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Server-component API access.
 *
 * Talks to the API directly rather than through the BFF, because a server
 * component is already on the server — routing through our own HTTP proxy would
 * add a hop for nothing.
 */
export async function serverApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await auth();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  const response = await fetch(`${API}/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  });

  /**
   * Not signed in, or no longer signed in — which is not a page failure.
   *
   * The route guard catches this before the page renders in every ordinary
   * case. What reaches here is the narrow race where the token was alive when
   * the request was admitted and expired before this fetch went out. Rendering
   * "Something went wrong" for that tells somebody the application is broken
   * when the truthful answer is that they need to sign in again.
   *
   * Deliberately no `next`: at this point the request is already mid-render,
   * and reconstructing which page it belongs to would mean threading the
   * pathname through every caller for the rarest of the two paths. The guard
   * supplies the return address for the case people actually hit.
   */
  if (response.status === 401) {
    redirect(loginWithReturn('/'));
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

// Re-exported so a call site needs one import beside `serverApi`, not two.
export { isFrameworkSignal, swallow } from './framework-signals';
