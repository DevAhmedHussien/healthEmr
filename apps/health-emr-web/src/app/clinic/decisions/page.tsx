import { serverApi } from '@/lib/server-api';
import { Card } from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import { CheckCircleIcon, RxPadIcon, XIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { VisitTable } from '../visit-table';

interface Summary {
  work: { decided: number; approved: number; denied: number; approvalRate: number | null };
  categories: Array<{ slug: string; name: string }>;
}

export const metadata = { title: 'My decisions — HealthEMR' };

export default async function ProviderDecisionsPage() {
  const summary = await serverApi<Summary>('v1/clinic/me/summary');

  return (
    <div className="space-y-6">
      <PageHeader
        title="My decisions"
        subtitle="Every visit you have approved or refused, and what you decided about each medication on it."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Reviews completed"
          value={summary.work.decided}
          tone="primary"
          icon={RxPadIcon}
        />
        <Stat
          label="Approved"
          value={summary.work.approved}
          tone="success"
          icon={CheckCircleIcon}
        />
        <Stat label="Refused" value={summary.work.denied} tone="neutral" icon={XIcon} />
      </div>

      {/* The approval rate is deliberately not a tile.
          It is shown on the earnings page as context, not here as a figure to
          move: approving less is not worse work, and a rate presented next to
          a count reads as a target. */}

      <Card>
        <VisitTable mode="decisions" categories={summary.categories} />
      </Card>
    </div>
  );
}
