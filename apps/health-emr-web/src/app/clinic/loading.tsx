import { PageLoader } from '@/components/portal/page-loader';

/**
 * Shown while a page inside this console is being prepared.
 *
 * The navigation and header are already on screen by this point — they belong
 * to the layout — so this only stands in for the content area.
 */
export default function Loading() {
  return <PageLoader />;
}
