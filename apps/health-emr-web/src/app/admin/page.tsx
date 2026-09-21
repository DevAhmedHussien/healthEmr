import Link from 'next/link';
import {
  VISIT_STAGE_LABEL,
  VISIT_STAGE_MEANING,
  isOpenStage,
  type VisitStage,
} from '@health-emr/types';
import { serverApi } from '@/lib/server-api';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import { PackageIcon, PillIcon, UsersIcon } from '@/components/ui/icons';
import { formatMoney, formatNumber } from '@/lib/format';
import { SpendPanel } from './spend-panel';
import { PageHeader } from '@/components/ui/page-header';
import { Figure } from '@/components/ui/figure';

export const metadata = { title: 'Overview — HealthEMR' };

interface Overview {
  stages: { stage: VisitStage; count: number }[];
  totals: { visits: number; patients: number; prescriptions: number };
}

/**
 * Stages that mean somebody has to do something, in the order they need doing.
 *
 * Stuck comes first because it is the only one where nothing is happening on its
 * own — every other stage is somebody else already working on it.
 */
const NEEDS_ATTENTION: VisitStage[] = ['STUCK', 'INFO_NEEDED', 'PENDING_REVIEW'];

/**
 * The on-ground tokens, not the fill ones.
 *
 * `--ar-warning` is #FA9148 — a fine colour for a badge background and 2.28:1
 * as a number on a white card, which is unreadable. These are the same hues
 * darkened to carry text.
 */
const ACCENT: Partial<Record<VisitStage, string>> = {
  STUCK: 'var(--ar-on-danger)',
  INFO_NEEDED: 'var(--ar-on-warning)',
  PENDING_REVIEW: 'var(--ar-on-warning)',
};

function StageTile({ stage, count }: { stage: VisitStage; count: number }) {
  const accent = ACCENT[stage];

  return (
    <Link
      href={`/admin/visits?stage=${stage}`}
      className="block rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4 transition-colors hover:border-[var(--ar-primary)]"
    >
      <span
        className="block text-2xl font-medium tabular-nums"
        style={accent && count > 0 ? { color: accent } : undefined}
      >
        {formatNumber(count)}
      </span>
      <span className="mt-0.5 block text-[0.85rem] font-medium text-[var(--ar-headings)]">
        {VISIT_STAGE_LABEL[stage]}
      </span>
      <span className="mt-1 block text-[0.74rem] leading-snug text-[var(--ar-text-faint)]">
        {VISIT_STAGE_MEANING[stage]}
      </span>
    </Link>
  );
}

interface Spend {
  today: Period;
  thisMonth: Period;
  lastThreeMonths: Period;
  last12Months: Period;
}

interface Period {
  medications: number;
  earnedCents: number;
  spendCents: number;
  marginCents: number;
  marginPercent: number | null;
  pricedShare: number;
  patientPricedShare: number;
}

export default async function AdminOverview() {
  const [overview, spend] = await Promise.all([
    serverApi<Overview>('v1/admin/overview'),
    serverApi<Spend>('v1/admin/spend/summary'),
  ]);
  const at = (stage: VisitStage) => overview.stages.find((row) => row.stage === stage)?.count ?? 0;
  const month = spend.thisMonth;

  const inFlight = overview.stages.filter(
    (row) => isOpenStage(row.stage) && !NEEDS_ATTENTION.includes(row.stage),
  );

  const closed = overview.stages.filter((row) => !isOpenStage(row.stage) && row.count > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Everything your business has sent us, and where it got to."
      />

      {/* The scale of the account, as tiles rather than a sentence. The three
          numbers were previously prose under the heading, where nobody reads
          them and none of them could be clicked. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Patients"
          value={formatNumber(overview.totals.patients)}
          tone="primary"
          icon={UsersIcon}
          href="/admin/patients"
        />
        <Stat
          label="Visits"
          value={formatNumber(overview.totals.visits)}
          tone="info"
          icon={PackageIcon}
          href="/admin/visits"
        />
        <Stat
          label="Prescriptions signed"
          value={formatNumber(overview.totals.prescriptions)}
          tone="success"
          icon={PillIcon}
          href="/admin/prescriptions"
        />
      </div>

      <Card>
        <CardHeader
          title="This month"
          subtitle="What your patients paid you, what those medications cost you, and what is left."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Patients paid you"
            value={formatMoney(month.earnedCents)}
            hint={`${formatNumber(month.medications)} medication${month.medications === 1 ? '' : 's'} dispensed`}
          />
          <Figure
            label="You owe us"
            value={formatMoney(month.spendCents)}
            hint="Charged only for what a clinician approved"
            tone="muted"
          />
          <Figure
            label="Your margin"
            value={formatMoney(month.marginCents)}
            hint={
              month.marginPercent === null
                ? 'Tell us what you charge to see this'
                : `${month.marginPercent}% of what you took`
            }
            tone="accent"
          />
          <Figure
            label="Last 3 months"
            value={formatMoney(spend.lastThreeMonths.marginCents)}
            hint={`${formatMoney(spend.lastThreeMonths.earnedCents)} taken · ${formatMoney(spend.lastThreeMonths.spendCents)} owed`}
          />
        </div>

        {month.patientPricedShare < 1 ? (
          <p className="mt-3 text-[0.78rem] text-[var(--ar-on-warning)]">
            Some visits arrived without a patient price, so what you took — and your margin — is
            understated. Send <code>patientPaidCents</code> on each line of the intake to fix it.
          </p>
        ) : null}

        {month.pricedShare < 1 ? (
          <p className="mt-2 text-[0.78rem] text-[var(--ar-on-warning)]">
            Some medications you were sent have no agreed price yet, so what you owe is lower here
            than on your eventual invoice. Ask your account manager to price them.
          </p>
        ) : null}
      </Card>

      <SpendPanel />

      <Card>
        <CardHeader title="Needs attention" subtitle="Nothing moves on these until somebody acts" />
        <div className="grid gap-3 sm:grid-cols-3">
          {NEEDS_ATTENTION.map((stage) => (
            <StageTile key={stage} stage={stage} count={at(stage)} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="In flight" subtitle="Already moving, with somebody else" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {inFlight.map((row) => (
            <StageTile key={row.stage} stage={row.stage} count={row.count} />
          ))}
        </div>
      </Card>

      {closed.length > 0 ? (
        <Card>
          <CardHeader title="Closed" />
          <div className="grid gap-3 sm:grid-cols-3">
            {closed.map((row) => (
              <StageTile key={row.stage} stage={row.stage} count={row.count} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
