import { serverApi } from '@/lib/server-api';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  TableWrap,
  statusTone,
} from '@/components/ui/primitives';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'My work and balance — HealthEMR' };

interface Summary {
  work: {
    decided: number;
    approved: number;
    denied: number;
    thisMonth: number;
    approvalRate: number | null;
  };
  balance: {
    unpaidCents: number;
    awaitingApprovalCents: number;
    approvedForPayoutCents: number;
    paidCents: number;
    lifetimeCents: number;
    since: string | null;
  };
  unrecorded: number;
}

interface Earning {
  id: string;
  visitId: string;
  masterId: string;
  category: string;
  patientMrn: string;
  client: string;
  outcome: string;
  amountCents: number;
  status: string;
  earnedAt: string;
  paidAt: string | null;
  payoutReference: string | null;
}

const PAYOUT_LABEL: Record<string, string> = {
  PENDING: 'awaiting approval',
  APPROVED_FOR_PAYOUT: 'approved for payout',
  PAID: 'paid',
  VOID: 'void',
};

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4">
      <p
        className="text-2xl font-semibold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[0.85rem] font-medium text-[var(--ar-headings)]">{label}</p>
      {hint ? (
        <p className="mt-1 text-[0.74rem] leading-snug text-[var(--ar-text-faint)]">{hint}</p>
      ) : null}
    </div>
  );
}

export default async function ProviderEarnings() {
  const [summary, ledger] = await Promise.all([
    serverApi<Summary>('v1/clinic/me/summary'),
    serverApi<{ data: Earning[] }>('v1/clinic/me/earnings'),
  ]);

  const { work, balance } = summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="My work and balance"
        subtitle={
          <>
            Every completed review earns the same, approved or denied
            {balance.since ? `. Counting from ${formatDate(balance.since)}` : ''}.
          </>
        }
      />

      {summary.unrecorded > 0 ? (
        <Alert tone="warning">
          <strong>
            {summary.unrecorded} completed{' '}
            {summary.unrecorded === 1 ? 'review has' : 'reviews have'} no payment recorded against{' '}
            {summary.unrecorded === 1 ? 'it' : 'them'}.
          </strong>{' '}
          The clinical decision stands — recording the fee is a separate step, and it did not
          happen. Raise it with the platform so the balance below can be corrected.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Reviews completed" subtitle="The work itself" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="All time" value={formatNumber(work.decided)} />
          <Stat label="This month" value={formatNumber(work.thisMonth)} />
          <Stat
            label="Approved"
            value={formatNumber(work.approved)}
            hint={
              work.approvalRate !== null ? `${work.approvalRate}% of your decisions` : undefined
            }
          />
          <Stat
            label="Not approved"
            value={formatNumber(work.denied)}
            hint="Paid the same. Declining is clinical work too."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Balance" subtitle="What has been recorded against those reviews" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Owed to you"
            value={formatMoney(balance.unpaidCents)}
            hint="Earned and not yet paid out."
            accent={balance.unpaidCents > 0 ? 'var(--ar-primary)' : undefined}
          />
          <Stat
            label="Awaiting approval"
            value={formatMoney(balance.awaitingApprovalCents)}
            hint="Recorded, not yet released for payout."
          />
          <Stat
            label="Approved for payout"
            value={formatMoney(balance.approvedForPayoutCents)}
            hint="Released. On its way in the next run."
          />
          <Stat label="Paid to date" value={formatMoney(balance.paidCents)} />
        </div>
        <p className="mt-3 text-[0.78rem] text-[var(--ar-text-muted)]">
          Each line below is priced at the rate in force on the day you decided it, so a later rate
          change never restates work you have already done. Lifetime total{' '}
          {formatMoney(balance.lifetimeCents)}.
        </p>
      </Card>

      <Card className="p-0">
        <div className="p-6 pb-0">
          <CardHeader
            title={`${ledger.data.length} most recent`}
            subtitle="The lines behind the totals above"
          />
        </div>
        {ledger.data.length === 0 ? (
          <EmptyState
            title="Nothing earned yet"
            hint="A line appears here each time you complete a review."
          />
        ) : (
          <div className="px-6 pb-6">
            <TableWrap>
              <thead>
                <tr>
                  <th>Decided</th>
                  <th>Treatment</th>
                  <th>Patient</th>
                  <th>Client</th>
                  <th>Outcome</th>
                  <th>Fee</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular-nums">{formatDate(row.earnedAt)}</td>
                    <td>{row.category}</td>
                    <td className="tabular-nums">{row.patientMrn}</td>
                    <td>{row.client}</td>
                    <td>
                      <Badge tone={statusTone(row.outcome)}>{row.outcome.toLowerCase()}</Badge>
                    </td>
                    <td className="tabular-nums">{formatMoney(row.amountCents)}</td>
                    <td>
                      <Badge tone={row.status === 'PAID' ? 'success' : 'neutral'}>
                        {PAYOUT_LABEL[row.status] ?? row.status.toLowerCase()}
                      </Badge>
                      {row.payoutReference ? (
                        <span className="block text-[0.72rem] tabular-nums text-[var(--ar-text-faint)]">
                          {row.payoutReference}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Card>
    </div>
  );
}
