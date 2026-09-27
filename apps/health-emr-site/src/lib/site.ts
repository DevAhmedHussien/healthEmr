/** Facts about the site itself, in one place so metadata and copy cannot drift. */

export const SITE_NAME = 'HealthEMR';
export const TAGLINE = 'The clinical layer behind your telehealth brand';
export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3006';

/**
 * Where the company is.
 *
 * Carried in the structured data as a real postal address, not just mentioned
 * in prose: "telehealth EMR" is a national search, but "Tampa" is how a local
 * clinician or a Florida pharmacy finds us, and a crawler will only treat the
 * location as a fact about the business if it is stated as one.
 */
export const COMPANY = {
  locality: 'Tampa',
  region: 'FL',
  regionName: 'Florida',
  country: 'US',
  where: 'Tampa, Florida',
} as const;

/** Where applications are sent. Empty means the forms are not wired up. */
export const API_BASE_URL = process.env.API_BASE_URL ?? '';

/**
 * The navigation, and the sitemap, from one list.
 *
 * Two copies of "which pages exist" is how a page ends up live but absent from
 * the sitemap — indexed late or not at all.
 */
export const PAGES = [
  { href: '/', label: 'Home', priority: 1, inNav: false },
  { href: '/platform', label: 'How it works', priority: 0.9, inNav: true },
  { href: '/for-telehealth', label: 'For telehealth brands', priority: 0.9, inNav: true },
  { href: '/for-clinicians', label: 'For clinicians', priority: 0.9, inNav: true },
  { href: '/for-pharmacies', label: 'For pharmacies', priority: 0.9, inNav: true },
  { href: '/security', label: 'Security', priority: 0.8, inNav: true },
  { href: '/apply/telehealth', label: 'Start a telehealth brand', priority: 0.7, inNav: false },
  { href: '/apply/clinician', label: 'Apply as a clinician', priority: 0.7, inNav: false },
  { href: '/apply/pharmacy', label: 'Apply as a pharmacy', priority: 0.7, inNav: false },
] as const;

export const NAV = PAGES.filter((page) => page.inNav);
