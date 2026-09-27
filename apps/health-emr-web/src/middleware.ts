import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@health-emr/types';
import { decideRoute } from '@/lib/route-guard';

/**
 * Redirects before any HTML is sent.
 *
 * The adapter only: it reads the session off the request, asks `decideRoute`
 * what should happen, and carries that out. Every rule — and every reason for
 * one — lives in `lib/route-guard.ts`, where it can be tested without a
 * request object.
 *
 * This is for user experience, not security. The API enforces the same rules
 * independently. But it matters that a patient never *briefly renders* a
 * provider's queue: in an EMR, "showed the wrong chart for 200ms" is an
 * incident, not a flicker.
 */
export default auth(
  (
    request: NextRequest & {
      auth: { user?: { role?: Role }; error?: string } | null;
    },
  ) => {
    const decision = decideRoute({
      pathname: request.nextUrl.pathname,
      role: request.auth?.user?.role,
      error: request.auth?.error,
    });

    return decision.type === 'redirect'
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : NextResponse.next();
  },
);

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
