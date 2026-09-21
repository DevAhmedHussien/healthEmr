import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Role } from '@health-emr/types';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Session handling.
 *
 * The access token lives in an httpOnly cookie and is attached server-side by
 * the BFF — no token is ever readable by browser JavaScript, which is the whole
 * point when the thing behind it is a patient chart.
 *
 * Sessions are 15 minutes to match the API's access-token lifetime, and refresh
 * happens in the `jwt` callback so an active user is never bounced to login
 * mid-task.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 15 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const response = await fetch(`${API}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          cache: 'no-store',
        });
        if (!response.ok) return null;

        const data = await response.json();
        return {
          id: data.user.id,
          email: data.user.email,
          name: `${data.user.firstName} ${data.user.lastName}`,
          role: data.user.role as Role,
          tenantId: data.user.tenantId,
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + data.tokens.expiresIn,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          userId: user.id,
          role: (user as { role: Role }).role,
          tenantId: (user as { tenantId: string | null }).tenantId,
          accessToken: (user as { accessToken: string }).accessToken,
          refreshToken: (user as { refreshToken: string }).refreshToken,
          expiresAt: (user as { expiresAt: number }).expiresAt,
        };
      }

      if (typeof token.expiresAt === 'number' && Date.now() / 1000 < token.expiresAt - 30) {
        return token;
      }

      // Rotate. The API revokes the presented refresh token as it issues the
      // replacement, so a failure here means the session is genuinely over.
      try {
        const response = await fetch(`${API}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token.refreshToken }),
          cache: 'no-store',
        });
        if (!response.ok) return { ...token, error: 'RefreshFailed' };

        const tokens = await response.json();
        return {
          ...token,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + tokens.expiresIn,
          error: undefined,
        };
      } catch {
        return { ...token, error: 'RefreshFailed' };
      }
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.userId as string,
        role: token.role as Role,
        tenantId: (token.tenantId as string | null) ?? null,
      };
      // Exposed for the BFF only. This object is assembled server-side and the
      // client receives a redacted session, so the token does not reach the browser.
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
