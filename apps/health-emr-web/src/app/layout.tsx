import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { SessionProvider } from 'next-auth/react';
import { auth } from '@/auth';
import './globals.css';

/**
 * Three weights, not five.
 *
 * The design system uses 400 for body, 500 for headings and card titles, and
 * 600 for the few places that need to shout. 300 was never used at all and 700
 * survived only on the logo lockup, which reads the same at 600. Each weight is
 * a separate file on the critical path, so the two that were doing nothing were
 * costing every first paint.
 */
/**
 * Served from the repository, not fetched from Google at build time.
 *
 * `next/font/google` downloads the file while building and caches it under
 * `.next`. That makes the build depend on reaching fonts.gstatic.com — so a
 * clean checkout, a CI runner without egress, or simply deleting `.next` turns
 * every page into a 500 with a network error in it. Which is exactly what
 * happened here.
 *
 * Self-hosting also means the browser never asks Google for anything, which is
 * one fewer third party seeing that a particular person opened a medical
 * record.
 */
const poppins = localFont({
  src: [
    { path: './fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/poppins-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
  // Matched to Poppins' metrics so the fallback does not reflow when the real
  // face arrives.
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'HealthEMR',
  description: 'Multi-tenant telehealth EMR platform',
  robots: { index: false, follow: false },
};

/**
 * The session is read on the server and handed to the provider.
 *
 * Left to itself `SessionProvider` fetches `/api/auth/session` from the browser
 * after hydration — a round trip on every single page load, before the user
 * menu can render a name. We already know who they are by the time we render
 * the HTML, so we say so.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
