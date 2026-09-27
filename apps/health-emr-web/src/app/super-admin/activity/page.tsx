import { serverApi, swallow } from '@/lib/server-api';
import { Card } from '@/components/ui/primitives';
import { ActivityList } from './list';
import { formatDateShort, formatDateTime, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Activity — HealthEMR' };

interface Integrity {
  checked: number;
  intact: boolean;
  brokenAtSequence: string | null;
  reason: string | null;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
}

export default async function ActivityPage() {
  const integrity = await serverApi<Integrity>('v1/super-admin/activity/integrity').catch(swallow(null));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity"
        subtitle="Every privileged action on the platform — who did it, to what, and when. Entries are
          hash-chained to each other, so an entry cannot be edited or removed without the chain
          saying so."
      />

      {integrity ? (
        <Card
          className={
            integrity.intact
              ? 'border-l-4 border-l-[var(--ar-on-success)]'
              : 'border-l-4 border-l-[var(--ar-danger)] bg-[var(--ar-danger-soft)]'
          }
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-[0.95rem] font-medium text-[var(--ar-headings)]">
                {integrity.intact ? 'Chain verified' : 'Chain broken'}
              </p>
              <p className="mt-1 text-[0.85rem] text-[var(--ar-text-muted)]">
                {integrity.intact
                  ? `All ${formatNumber(integrity.checked)} entries reconcile with the one before them.`
                  : integrity.reason}
              </p>
            </div>
            <p className="text-[0.78rem] tabular-nums text-[var(--ar-text-faint)]">
              {formatDateShort(integrity.firstEntryAt)} — {formatDateTime(integrity.lastEntryAt)}
            </p>
          </div>
        </Card>
      ) : null}

      <ActivityList />
    </div>
  );
}
