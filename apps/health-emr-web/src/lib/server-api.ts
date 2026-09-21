import { auth } from '@/auth';

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

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}
