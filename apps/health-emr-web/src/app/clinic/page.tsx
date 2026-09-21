import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import { Card } from '@/components/ui/primitives';
import { formatMoney, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { VisitTable } from './visit-table';

interface Summary {
  work: { decided: number; thisMonth: number };
  balance: { unpaidCents: number };
  /** What this clinician may treat — the queue filter is built from it. */
  categories: Array<{ slug: string; name: string }>;
}

export default async function ProviderQueue() {
  // The queue itself is fetched by the table, which owns the filters and
  // refetches as they change. Fetching it here as well would render one list
  // and immediately replace it with another.
  const summary = await serverApi<Summary>('v1/clinic/me/summary');

  return (
    <div className="space-y-6">
      <PageHeader
        title="My queue"
        subtitle="Visits assigned to you, longest waiting first. You only ever see patients in states you hold a current licence for."
        action={
          /* The two numbers a clinician actually wants on arrival: how much
             they have done, and what they are owed. Both link through to the
             detail rather than being a dead end. */
          <Link
            href="/clinic/earnings"
            className="flex gap-6 rounded-[var(--ar-radius)] border border-[var(--ar-border)] px-4 py-3 transition-colors hover:border-[var(--ar-primary)]"
          >
            <span>
              <span className="block text-xl font-medium tabular-nums text-[var(--ar-headings)]">
                {formatNumber(summary.work.decided)}
              </span>
              <span className="block text-[0.75rem] text-[var(--ar-text-muted)]">
                reviews · {formatNumber(summary.work.thisMonth)} this month
              </span>
            </span>
            <span>
              <span className="block text-xl font-medium tabular-nums text-[var(--ar-primary)]">
                {formatMoney(summary.balance.unpaidCents)}
              </span>
              <span className="block text-[0.75rem] text-[var(--ar-text-muted)]">owed to you</span>
            </span>
          </Link>
        }
      />

      <Card>
        <VisitTable mode="queue" categories={summary.categories} />
      </Card>
    </div>
  );
}
