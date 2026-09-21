import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ROLE_HOME_ROUTE, type Role } from '@health-emr/types';

/** Which role owns which route group. */
const OWNERSHIP: Record<string, Role[]> = {
  '/portal': ['PATIENT'],
  '/clinic': ['PROVIDER'],
  '/dispensary': ['PHARMACY'],
  '/admin': ['ADMIN'],
  '/super-admin': ['SUPER_ADMIN'],
};

/**
 * Redirects before any HTML is sent.
 *
 * This is for user experience, not security — the API enforces the same rules
 * independently. But it matters that a patient never *briefly renders* a
 * provider's queue: in an EMR, "showed the wrong chart for 200ms" is an incident,
 * not a flicker.
 */
export default auth((request: NextRequest & { auth: { user?: { role?: Role } } | null }) => {
  const { pathname } = request.nextUrl;
  const role = request.auth?.user?.role;

  const guarded = Object.keys(OWNERSHIP).find((prefix) => pathname.startsWith(prefix));

  if (guarded) {
    if (!role) {
      const login = new URL('/login', request.url);
      login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }
    if (!OWNERSHIP[guarded].includes(role)) {
      return NextResponse.redirect(new URL(ROLE_HOME_ROUTE[role], request.url));
    }
  }

  if (pathname === '/login' && role) {
    return NextResponse.redirect(new URL(ROLE_HOME_ROUTE[role], request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/portal/:path*',
    '/clinic/:path*',
    '/dispensary/:path*',
    '/admin/:path*',
    '/super-admin/:path*',
    // Every signed-in role has one, so it is guarded but not owned by any of them.
    '/profile',
    '/login',
  ],
};
