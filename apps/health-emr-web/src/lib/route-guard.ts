import { ROLE_HOME_ROUTE, type Role } from '@health-emr/types';

/** Which role owns which route group. */
export const OWNERSHIP: Record<string, Role[]> = {
  '/portal': ['PATIENT'],
  '/clinic': ['PROVIDER'],
  '/dispensary': ['PHARMACY'],
  '/admin': ['ADMIN'],
  // An owner works in the super admin console; the role is a superset.
  '/super-admin': ['SUPER_ADMIN', 'OWNER'],
};

/**
 * The value the session carries once refreshing the access token has failed.
 *
 * Set in the `jwt` callback: the API revokes the presented refresh token as it
 * issues the replacement, so a failure there means the session is genuinely
 * over rather than momentarily unlucky.
 */
export const SESSION_EXPIRED = 'RefreshFailed';

export interface GuardInput {
  pathname: string;
  /** From the session cookie. Undefined when there is no session at all. */
  role?: Role;
  /** `session.error` — set to SESSION_EXPIRED when the refresh could not be rotated. */
  error?: string;
}

export type GuardDecision = { type: 'allow' } | { type: 'redirect'; to: string };

/**
 * Where this request should go, decided from the session alone.
 *
 * Separated from the middleware so the rules can be read and tested without a
 * request object. The middleware is the adapter; this is the decision.
 *
 * Not a security boundary — the API enforces all of this independently. What it
 * buys is that a patient never *briefly renders* a provider's queue, which in
 * an EMR is an incident rather than a flicker.
 */
export function decideRoute({ pathname, role, error }: GuardInput): GuardDecision {
  // A session whose refresh failed is over, whatever the cookie still says.
  //
  // This is the case that used to fall through. The cookie still decrypted and
  // still carried a role, so the guard waved the request past — and then every
  // server-side fetch answered 401 and the page rendered "Something went
  // wrong", which is not what being logged out should look like.
  const expired = error === SESSION_EXPIRED;
  const signedIn = Boolean(role) && !expired;

  const guarded = Object.keys(OWNERSHIP).find((prefix) => pathname.startsWith(prefix));

  if (guarded) {
    if (!signedIn) return { type: 'redirect', to: loginWithReturn(pathname) };
    if (!OWNERSHIP[guarded].includes(role as Role)) {
      return { type: 'redirect', to: ROLE_HOME_ROUTE[role as Role] };
    }
    return { type: 'allow' };
  }

  // `signedIn`, not `role`. Keyed on the role alone, an expired session would
  // be sent from /login to its home page, and from there back to /login —
  // a loop that only ends when the cookie is cleared by hand.
  if (pathname === '/login' && signedIn) {
    return { type: 'redirect', to: ROLE_HOME_ROUTE[role as Role] };
  }

  return { type: 'allow' };
}

/**
 * The login URL, carrying where to come back to.
 *
 * Only ever a path from this application's own routing. `next` is read back as
 * a destination after signing in, and a full URL there would be an open
 * redirect — somewhere to send a phished user that looks like our own link.
 */
export function loginWithReturn(pathname: string): string {
  const safe = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/';
  return `/login?next=${encodeURIComponent(safe)}`;
}
