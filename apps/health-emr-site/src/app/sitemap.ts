import type { MetadataRoute } from 'next';
import { PAGES, SITE_URL } from '@/lib/site';

/**
 * Built from the same list the navigation uses.
 *
 * Two copies of "which pages exist" is how a page ends up live but missing from
 * the sitemap, and indexed weeks late or not at all.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map((page) => ({
    url: `${SITE_URL}${page.href === '/' ? '' : page.href}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: page.priority,
  }));
}
