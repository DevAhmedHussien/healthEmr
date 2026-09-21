import { AppLoader } from '@/components/portal/page-loader';

/**
 * Shown while a console's layout resolves.
 *
 * Each console's layout is an async server component that reads the session, so
 * this is what stands in during the moment right after signing in — when there
 * is no navigation on screen yet to put a narrower skeleton inside.
 */
export default function Loading() {
  return <AppLoader />;
}
