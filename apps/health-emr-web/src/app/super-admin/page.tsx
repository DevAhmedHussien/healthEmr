import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import { Badge, Card, CardHeader, EmptyState, TableWrap } from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import {
  AlertTriangleIcon,
  BuildingIcon,
  ClipboardIcon,
  CreditCardIcon,
  InboxIcon,
  PillIcon,
  StethoscopeIcon,
  UsersIcon,
} from '@/components/ui/icons';
import { RevenuePanel } from '@/components/portal/revenue-panel';
import { TenantRevenue } from './tenant-revenue';
import { StateList } from '@/components/portal/state-list';
import { PageHeader } from '@/components/ui/page-header';
import { formatMoney } from '@/lib/format';

interface Overview {
  counts: {
    activePharmacies: number;
    totalPharmacies: number;
    activeProviders: number;
    totalProviders: number;
    prescriptions: number;
    prescriptionsThisMonth: number;
    adminAccounts: number;
    activeAdminAccounts: number;
    patients: number;
    pendingApplications: number;
    pendingVisits: number;
    stuckOrders: number;
    owedCents: number;
    paidCents: number;
  };
  activeProviders: Array<{
    id: string;
    name: string;
    credentials: string;
    states: string[];
    categories: string[];
    assignedAdmin: string | null;
    openRequests: number;
    capacity: number;
    accepting: boolean;
    reviews: number;
    approved: number;
    refused: number;
    owedCents: number;
  }>;
  activePharmacies: Array<{
    id: string;
    name: string;
    slug: string;
    integrationType: string;
    dispenses: string[];
    categories: string[];
    products: number;
    tenants: number;
  }>;
}

export const metadata = { title: 'Overview — HealthEMR' };

export default async function SuperAdminOverview() {
  const { counts, activeProviders, activePharmacies } =
    await serverApi<Overview>('v1/super-admin/overview');

  const totalOwed = activeProviders.reduce((sum, provider) => sum + provider.owedCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="The whole platform, across every admin account." />

      {/* Two bands, not eight tiles in a heap.
          The first is the size of the business and never needs acting on; the
          second is work waiting for someone, and every tile in it is a link to
          the queue it counts. Splitting them means the reader can stop after
          the second row on a quiet morning. */}
      <section aria-labelledby="scale-heading" className="space-y-3">
        <h3
          id="scale-heading"
          className="text-[0.78rem] font-medium uppercase tracking-[0.06em] text-[var(--ar-text-faint)]"
        >
          The platform
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Patients"
            value={counts.patients}
            tone="primary"
            icon={UsersIcon}
            href="/super-admin/patients"
          />
          <Stat
            label="Prescriptions"
            value={counts.prescriptions}
            sub={`${counts.prescriptionsThisMonth} this month`}
            tone="success"
            icon={PillIcon}
            href="/super-admin/prescriptions"
          />
          <Stat
            label="Client accounts"
            value={counts.activeAdminAccounts}
            sub={`${counts.adminAccounts} total`}
            tone="info"
            icon={BuildingIcon}
            href="/super-admin/admins"
          />
          <Stat
            label="Clinicians"
            value={counts.activeProviders}
            sub={`${counts.totalProviders} total · ${counts.activePharmacies} pharmacies`}
            tone="neutral"
            icon={StethoscopeIcon}
            href="/super-admin/providers"
          />
        </div>
      </section>

      <section aria-labelledby="attention-heading" className="space-y-3">
        <h3
          id="attention-heading"
          className="text-[0.78rem] font-medium uppercase tracking-[0.06em] text-[var(--ar-text-faint)]"
        >
          Waiting on someone
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Visits awaiting a decision"
            value={counts.pendingVisits}
            tone={counts.pendingVisits > 0 ? 'warning' : 'success'}
            icon={InboxIcon}
            href="/super-admin/visits?stage=PENDING_REVIEW"
          />
          <Stat
            label="Applications to review"
            value={counts.pendingApplications}
            tone={counts.pendingApplications > 0 ? 'warning' : 'success'}
            icon={ClipboardIcon}
            href="/super-admin/applications"
          />
          <Stat
            label="Orders stuck"
            value={counts.stuckOrders}
            tone={counts.stuckOrders > 0 ? 'danger' : 'success'}
            icon={AlertTriangleIcon}
            href="/super-admin/stuck"
          />
          <Stat
            label="Owed to clinicians"
            value={formatMoney(counts.owedCents)}
            sub={`${formatMoney(counts.paidCents)} paid to date`}
            tone="danger"
            icon={CreditCardIcon}
            href="/super-admin/reports"
          />
        </div>
      </section>

      <RevenuePanel endpoint="v1/super-admin/revenue/series" />

      <TenantRevenue />

      <Card className="p-0">
        <div className="p-6 pb-0">
          <CardHeader
            title="Active providers"
            subtitle={`${activeProviders.length} clinicians · ${formatMoney(totalOwed)} payable for work completed`}
            action={
              <Link href="/super-admin/providers" className="text-[0.85rem] font-medium">
                Full directory →
              </Link>
            }
          />
        </div>
        {activeProviders.length === 0 ? (
          <EmptyState
            title="No active providers"
            hint="Approve a provider application to add one."
          />
        ) : (
          <div className="px-6 pb-6">
            <TableWrap>
              <thead>
                <tr>
                  <th>Clinician</th>
                  <th>Licensed states</th>
                  <th>Categories</th>
                  <th>Queue</th>
                  <th>Reviews</th>
                  <th>Approved</th>
                  <th>Refused</th>
                  <th>Payable</th>
                </tr>
              </thead>
              <tbody>
                {activeProviders.map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <span className="font-medium text-[var(--ar-headings)]">{provider.name}</span>
                      <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                        {provider.credentials}
                        {provider.assignedAdmin ? ` · ${provider.assignedAdmin}` : ''}
                      </span>
                    </td>
                    <td>
                      <StateList states={provider.states} show={3} />
                    </td>
                    <td className="text-[0.8rem]">{provider.categories.length}</td>
                    <td className="tabular-nums">
                      {provider.openRequests}/{provider.capacity}
                      {!provider.accepting ? (
                        <span className="ml-1 text-[0.7rem] text-[var(--ar-on-warning)]">
                          paused
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular-nums font-medium">{provider.reviews}</td>
                    <td className="tabular-nums">{provider.approved}</td>
                    <td className="tabular-nums">{provider.refused}</td>
                    <td className="tabular-nums font-medium">{formatMoney(provider.owedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-3 text-[0.75rem] text-[var(--ar-text-faint)]">
              Providers are paid per completed review — an approval and a refusal are the same work,
              so both count.
            </p>
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="p-6 pb-0">
          <CardHeader
            title="Active pharmacies"
            subtitle={`${activePharmacies.length} dispensing partners`}
            action={
              <Link href="/super-admin/pharmacies" className="text-[0.85rem] font-medium">
                Full directory →
              </Link>
            }
          />
        </div>
        {activePharmacies.length === 0 ? (
          <EmptyState title="No active pharmacies" />
        ) : (
          <div className="px-6 pb-6">
            <TableWrap>
              <thead>
                <tr>
                  <th>Pharmacy</th>
                  <th>Integration</th>
                  <th>Dispenses</th>
                  <th>Categories</th>
                  <th>Products</th>
                  <th>Accounts</th>
                </tr>
              </thead>
              <tbody>
                {activePharmacies.map((pharmacy) => (
                  <tr key={pharmacy.id}>
                    <td>
                      <span className="font-medium text-[var(--ar-headings)]">{pharmacy.name}</span>
                      <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                        {pharmacy.slug}
                      </span>
                    </td>
                    <td>
                      <Badge tone="primary">{pharmacy.integrationType}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {pharmacy.dispenses.map((what) => (
                          <Badge key={what} tone="info">
                            {what}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="text-[0.8rem]">{pharmacy.categories.join(', ') || '—'}</td>
                    <td className="tabular-nums">{pharmacy.products}</td>
                    <td className="tabular-nums">{pharmacy.tenants}</td>
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
