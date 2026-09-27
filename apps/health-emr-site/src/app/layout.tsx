import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SITE_NAME, SITE_URL, TAGLINE } from '@/lib/site';
import './globals.css';

/**
 * Self-hosted, exactly as the product does it.
 *
 * `next/font/google` fetches the file at build time, which makes a clean
 * checkout or a CI runner without egress fail the build. It also means the
 * browser never asks Google for anything — worth keeping on a site read by
 * clinicians and pharmacies looking into a medical system.
 */
const poppins = localFont({
  src: [
    { path: './fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/poppins-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${TAGLINE}`,
    // Each page names itself; this keeps the brand on the end without every
    // page having to remember to add it.
    template: `%s — ${SITE_NAME}`,
  },
  description:
    'HealthEMR runs the clinical side of a telehealth business: licensed review in the patient’s own state, pharmacy fulfilment, and a patient record that holds up to an audit.',
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: SITE_URL,
    locale: 'en_US',
    title: `${SITE_NAME} — ${TAGLINE}`,
    description:
      'Licensed clinical review, contracted pharmacies and an auditable patient record — the clinical layer behind your telehealth brand.',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${TAGLINE}`,
    description: 'The clinical layer behind your telehealth brand.',
  },
  category: 'healthcare',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        {/* First in the DOM, so a keyboard user is not walked through the whole
            navigation on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius)] focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
