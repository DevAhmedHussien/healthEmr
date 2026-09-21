import Link from 'next/link';
import { CreditCardIcon, PillIcon, StethoscopeIcon, UsersIcon } from '@/components/ui/icons';
import { serverApi } from '@/lib/server-api';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import { PageHeader } from '@/components/ui/page-header';

interface Overview {
  counts: {
    prescriptions: number;
    prescriptionsThisMonth: number;
    patients: number;
    activeProviders: number;
    activePharmacies: number;
    owedCents: number;
  };
}

export const metadata = { title: 'Analytics — HealthEMR' };

export default async function AnalyticsPage() {
  const { counts } = await serverApi<Overview>('v1/super-admin/overview');

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Business performance across every admin account." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Prescriptions"
          icon={PillIcon}
          value={counts.prescriptions}
          sub={`${counts.prescriptionsThisMonth} this month`}
          tone="success"
        />
        <Stat label="Patients" value={counts.patients} tone="primary" icon={UsersIcon} />
        <Stat
          label="Active providers"
          value={counts.activeProviders}
          tone="info"
          icon={StethoscopeIcon}
        />
        <Stat
          label="Owed to providers"
          icon={CreditCardIcon}
          value={`$${(counts.owedCents / 100).toFixed(2)}`}
          tone="danger"
        />
      </div>

      <Card>
        <CardHeader
          title="Charts are not built yet"
          subtitle="Rather than show placeholder graphs, here is exactly what is missing and why."
        />
        <div className="space-y-3 text-[0.9rem] text-[var(--ar-text-muted)]">
          <p>
            Orders and revenue over time, breakdowns by pharmacy and category, the provider
            leaderboard and geography all depend on revenue — and revenue arrives from the partner
            API as <code className="rounded bg-[var(--ar-gray-50)] px-1">unitPriceCents</code> on
            each requested line. The column exists; no partner is sending it yet, so every revenue
            figure would currently be zero.
          </p>
          <p>
            The counts above are real and come from the database. Everything that would need money
            to be meaningful is deliberately absent rather than shown as an empty chart.
          </p>
          <p>
            Next step is seeding 10,000 patients and 50,000 orders with prices, measuring the
            queries against your two-second budget, and building the charts on whatever that
            measurement says — live SQL if it holds, a rollup table if it does not.
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/super-admin" className="text-[0.85rem] font-medium">
            ← Back to overview
          </Link>
        </div>
      </Card>
    </div>
  );
}
