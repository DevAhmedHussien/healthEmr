import { PageHeader } from '@/components/ui/page-header';
import { ActivityPanel } from '@/components/charts/activity-panel';

export const dynamic = 'force-dynamic';

/**
 * A clinician's own hours.
 *
 * Separate from "Work and pay" on purpose: that page answers what they earned,
 * this one answers how long it took. They are related questions but not the
 * same one, and a clinician checking whether a quiet week was really quiet does
 * not want to read it off a fee ledger.
 */
export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="My hours"
        subtitle="How long you were actually working each day, and how that compares with what you decided."
      />
      <ActivityPanel
        path="v1/clinic/me/activity"
        title="Time worked"
        subtitle="Counted from what you did, not from how long a tab was open."
      />
    </div>
  );
}
