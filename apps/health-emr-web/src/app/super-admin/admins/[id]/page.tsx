import Link from 'next/link';
import {
  BarChartIcon,
  CreditCardIcon,
  MortarIcon,
  PackageIcon,
  PillIcon,
  StethoscopeIcon,
  TrendingUpIcon,
  UserIcon,
  UsersIcon,
} from '@/components/ui/icons';
import { notFound } from 'next/navigation';
import { serverApi, swallow } from '@/lib/server-api';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  TableWrap,
  statusTone,
} from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import { ApiAccessPanel } from '@/components/integration/api-access-panel';
import { WebhookPanel } from '@/components/integration/webhook-panel';
import { ActionDialog } from '@/components/admin/action-dialog';
import { EditPanel } from '@/components/admin/edit-panel';
import { RosterPicker } from '@/components/admin/roster-picker';
import { ActivityFeed, type ActivityEntryView } from '@/components/admin/activity-feed';
import { formatDateShort, formatMoney } from '@/lib/format';

interface TenantProfile {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    contactEmail: string;
    contactPhone: string | null;
    ownerName: string | null;
    billingPlan: string | null;
    allowedStates: string[];
    createdAt: string;
    archivedAt: string | null;
    archivedReason: string | null;
  };
  counts: {
    patients: number;
    visits: number;
    prescriptions: number;
    orders: number;
    staff: number;
    activeApiKeys: number;
  };
  pipeline: Record<string, number>;
  pharmacies: Array<{
    id: string;
    name: string;
    status: string;
    isDefault: boolean;
    statesServed: string[];
    dispenses: string[];
    contactEmail: string | null;
    catalogSize: number;
    orders: number;
    costOfGoodsCents: number;
  }>;
  providers: Array<{
    id: string;
    name: string;
    email: string;
    credentials: string | null;
    status: string;
    acceptingWork: boolean;
    contracted: boolean;
    licensedStates: string[];
    reviews: number;
    prescriptionsSigned: number;
    owedCents: number;
    paidCents: number;
  }>;
  staff: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  }>;
  topMedications: Array<{
    medicationId: string;
    name: string;
    strength: string | null;
    isCompounded: boolean;
    prescriptions: number;
  }>;
  money: {
    revenueCents: number;
    costOfGoodsCents: number;
    providerFeesCents: number;
    marginCents: number;
    costCoverage: number;
  };
  volumeByMonth: Array<{ month: string; prescriptions: number }>;
  recentPrescriptions: Array<{
    id: string;
    medication: string;
    patient: string;
    mrn: string;
    prescriber: string;
    status: string;
    signedAt: string;
  }>;
}

const money = formatMoney;

export default async function AdminProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [profile, history] = await Promise.all([
    serverApi<TenantProfile>(`v1/super-admin/admins/${id}/profile`).catch(swallow(null)),
    serverApi<ActivityEntryView[]>(`v1/super-admin/activity/Tenant/${id}`).catch(swallow([] as ActivityEntryView[])),
  ]);
  if (!profile) notFound();

  const { tenant, counts, money: m } = profile;

  /**
   * Who works for this client now, and who used to.
   *
   * Ending a contract sets `endedAt` rather than deleting the link, so that a
   * prescription signed for this client three years ago can still say who
   * signed it. That is right, and it is not a reason to keep the person in a
   * list headed "clinicians on this roster" — which read as though the
   * contract had not ended at all, and left the row sitting there after the
   * button had plainly worked.
   *
   * So: the roster is the current contracts, and the ended ones are shown
   * below as what they are. They are not hidden, because an ended contract
   * with money still owed is exactly the row somebody needs to find.
   */
  const roster = profile.providers.filter((provider) => provider.contracted);
  const formerProviders = profile.providers.filter((provider) => !provider.contracted);

  const owed = profile.providers.reduce((sum, provider) => sum + provider.owedCents, 0);
  const peak = Math.max(1, ...profile.volumeByMonth.map((point) => point.prescriptions));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/admins" className="text-[0.8rem] font-medium">
            ← Client accounts
          </Link>
          <h2 className="mt-1">{tenant.name}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {tenant.slug} · {tenant.contactEmail}
            {tenant.ownerName ? ` · ${tenant.ownerName}` : ''} · since{' '}
            {formatDateShort(tenant.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(tenant.status)}>{tenant.status.toLowerCase()}</Badge>
          {tenant.billingPlan ? <Badge tone="primary">{tenant.billingPlan}</Badge> : null}
          <Badge tone="info">{counts.activeApiKeys} active API keys</Badge>
          {tenant.archivedAt ? (
            <ActionDialog
              label="Restore account"
              icon="restore"
              description={[
                'Reopens the account and reactivates its people.',
                'API keys stay revoked and must be reissued deliberately.',
              ]}
              path={`v1/super-admin/admins/${tenant.id}/restore`}
              variant="primary"
              successMessage="Account restored."
            />
          ) : (
            <ActionDialog
              label="Archive account"
              icon="archive"
              description={[
                'Closes the account, deactivates its people and revokes its API keys.',
                'Patients, prescriptions and invoices are retained — nothing clinical or financial is deleted, and this can be undone.',
              ]}
              path={`v1/super-admin/admins/${tenant.id}`}
              method="DELETE"
              variant="danger"
              confirmLabel="Archive"
              successMessage="Account archived."
            />
          )}
        </div>
      </div>

      {tenant.archivedAt ? (
        <div className="rounded-[var(--ar-radius)] border-l-4 border-[var(--ar-danger)] bg-[var(--ar-danger-soft)] px-4 py-3 text-[0.9rem] text-[var(--ar-on-danger)]">
          Archived {formatDateShort(tenant.archivedAt)}
          {tenant.archivedReason ? ` — ${tenant.archivedReason}` : ''}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Patients" value={counts.patients} tone="primary" icon={UsersIcon} />
        <Stat
          label="Visits"
          icon={PackageIcon}
          value={counts.visits}
          sub={pipelineSummary(profile.pipeline)}
          tone="info"
        />
        <Stat label="Prescriptions" value={counts.prescriptions} tone="success" icon={PillIcon} />
        <Stat label="Pharmacy orders" value={counts.orders} tone="warning" icon={MortarIcon} />
        <Stat label="Staff accounts" value={counts.staff} tone="primary" icon={UserIcon} />
      </div>

      <Card>
        <CardHeader
          title="Money"
          subtitle="What this client billed, what the goods cost us, and what we owe the clinicians who reviewed."
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Revenue"
            icon={TrendingUpIcon}
            value={money(m.revenueCents)}
            sub="prescribed lines only"
            tone="primary"
          />
          <Stat
            label="Cost of goods"
            icon={CreditCardIcon}
            value={money(m.costOfGoodsCents)}
            sub={`${Math.round(m.costCoverage * 100)}% of orders priced`}
            tone="warning"
          />
          <Stat
            label="Provider fees"
            icon={StethoscopeIcon}
            value={money(m.providerFeesCents)}
            sub={`${money(owed)} unpaid`}
            tone="info"
          />
          <Stat
            label="Margin"
            icon={BarChartIcon}
            value={money(m.marginCents)}
            sub={m.costCoverage < 1 ? 'provisional — some orders unpriced' : 'all orders priced'}
            tone={m.marginCents >= 0 ? 'success' : 'danger'}
          />
        </div>
        {m.costCoverage < 1 ? (
          <p className="mt-3 text-[0.78rem] text-[var(--ar-text-faint)]">
            Cost is taken from the price each pharmacy had recorded when the order was dispatched.
            Orders placed before their pharmacy priced the product are excluded rather than counted
            as free, which is why the coverage figure sits next to the total.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Account details"
          action={
            <EditPanel
              title="Edit client account"
              path={`v1/super-admin/admins/${tenant.id}`}
              fields={[
                { name: 'name', label: 'Business name', value: tenant.name },
                { name: 'ownerName', label: 'Owner', value: tenant.ownerName },
                {
                  name: 'contactEmail',
                  label: 'Contact email',
                  value: tenant.contactEmail,
                  type: 'email',
                },
                {
                  name: 'contactPhone',
                  label: 'Contact phone',
                  value: tenant.contactPhone,
                  type: 'phone',
                },
                {
                  name: 'billingPlan',
                  label: 'Billing plan',
                  value: tenant.billingPlan,
                },
                {
                  name: 'allowedStates',
                  label: 'States they may sell into',
                  value: tenant.allowedStates.join(', '),
                  type: 'states',
                  hint: 'Two-letter codes, comma separated. Empty means no commercial limit beyond licensing.',
                },
              ]}
            />
          }
        />
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          <Detail term="Contact" value={tenant.contactEmail} />
          <Detail term="Phone" value={tenant.contactPhone ?? '—'} />
          <Detail term="Owner" value={tenant.ownerName ?? '—'} />
          <Detail term="Billing plan" value={tenant.billingPlan ?? 'none set'} />
          <Detail
            term="Selling into"
            value={
              tenant.allowedStates.length ? tenant.allowedStates.join(', ') : 'no commercial limit'
            }
          />
          <Detail term="API keys" value={`${counts.activeApiKeys} active`} />
        </dl>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-0">
          <div className="p-6 pb-0">
            <CardHeader
              title="Pharmacies on this roster"
              subtitle="Who fills for this client, and what it costs."
              action={
                <RosterPicker
                  tenantId={tenant.id}
                  kind="pharmacy"
                  exclude={profile.pharmacies.map((pharmacy) => pharmacy.id)}
                />
              }
            />
          </div>
          {profile.pharmacies.length === 0 ? (
            <EmptyState
              title="No pharmacies attached"
              hint="This client cannot have anything dispensed until one is."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th scope="col">Pharmacy</th>
                  <th scope="col">States</th>
                  <th scope="col">Catalog</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Cost of goods</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {profile.pharmacies.map((pharmacy) => (
                  <tr key={pharmacy.id}>
                    <td>
                      <Link href={`/super-admin/pharmacies/${pharmacy.id}`} className="font-medium">
                        {pharmacy.name}
                      </Link>
                      <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                        {pharmacy.dispenses.join(' · ') || 'no dispensing flags'}
                        {pharmacy.isDefault ? ' · default' : ''}
                      </span>
                    </td>
                    <td className="text-[0.8rem]">{pharmacy.statesServed.join(', ') || '—'}</td>
                    <td className="tabular-nums">{pharmacy.catalogSize}</td>
                    <td className="tabular-nums">{pharmacy.orders}</td>
                    <td className="tabular-nums">{money(pharmacy.costOfGoodsCents)}</td>
                    <td>
                      <ActionDialog
                        label="Remove"
                        description={`Takes ${pharmacy.name} off this client's roster. Orders already filled are unaffected.`}
                        path={`v1/super-admin/admins/${tenant.id}/roster/remove`}
                        body={{ pharmacyId: pharmacy.id }}
                        variant="ghost"
                        confirmLabel="Remove from roster"
                        successMessage="Removed."
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card className="p-0">
          <div className="p-6 pb-0">
            <CardHeader
              title="Clinicians on this roster"
              subtitle="What each reviewed for this client, and what we owe them for it."
              action={
                <RosterPicker
                  tenantId={tenant.id}
                  kind="provider"
                  exclude={profile.providers.filter((p) => p.contracted).map((p) => p.id)}
                />
              }
            />
          </div>
          {roster.length === 0 ? (
            <EmptyState
              title="No clinicians attached"
              hint="Intakes for this client cannot be routed until one is."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th scope="col">Clinician</th>
                  <th scope="col">Licensed</th>
                  <th scope="col">Reviews</th>
                  <th scope="col">Signed</th>
                  <th scope="col">Owed</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {roster.map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <Link href={`/super-admin/providers/${provider.id}`} className="font-medium">
                        {provider.name}
                      </Link>
                      <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                        {provider.credentials ?? '—'}
                        {provider.acceptingWork ? '' : ' · not accepting work'}
                      </span>
                    </td>
                    <td className="text-[0.8rem]">{provider.licensedStates.join(', ') || '—'}</td>
                    <td className="tabular-nums">{provider.reviews}</td>
                    <td className="tabular-nums">{provider.prescriptionsSigned}</td>
                    <td className="tabular-nums">{money(provider.owedCents)}</td>
                    <td>
                      <ActionDialog
                        label="End"
                        description={`Ends ${provider.name}'s contract with this client. They move to past clinicians below; the link is kept, not deleted, so prescriptions they signed here stay explicable.`}
                        path={`v1/super-admin/admins/${tenant.id}/roster/remove`}
                        body={{ providerId: provider.id }}
                        variant="ghost"
                        confirmLabel="End contract"
                        successMessage="Contract ended."
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}

          {formerProviders.length > 0 ? (
            <div className="border-t border-[var(--ar-border)] p-6">
              <h3 className="text-[0.8rem] font-medium uppercase tracking-wide text-[var(--ar-text-muted)]">
                Past clinicians
              </h3>
              <p className="mt-1 text-[0.8rem] text-[var(--ar-text-faint)]">
                Contracts that have ended. Kept so the prescriptions they signed here still say who
                signed them — and so anything still owed can be found.
              </p>
              <ul className="mt-3 space-y-2">
                {formerProviders.map((provider) => (
                  <li
                    key={provider.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.85rem]"
                  >
                    <Link
                      href={`/super-admin/providers/${provider.id}`}
                      className="font-medium text-[var(--ar-text)]"
                    >
                      {provider.name}
                    </Link>
                    <span className="text-[var(--ar-text-faint)]">
                      {provider.prescriptionsSigned} signed · {provider.reviews} reviewed
                      {provider.owedCents > 0 ? (
                        // The one thing here that still needs doing. An ended
                        // contract with an unpaid balance is the row somebody
                        // comes looking for, so it does not whisper.
                        <span className="ml-2 font-medium text-[var(--ar-on-warning)]">
                          {money(provider.owedCents)} still owed
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Volume" subtitle="Prescriptions signed for this client, by month." />
          {profile.volumeByMonth.length === 0 ? (
            <EmptyState
              title="Nothing signed yet"
              hint="The trend appears once prescriptions are written."
            />
          ) : (
            <ul className="space-y-2">
              {profile.volumeByMonth.map((point) => (
                <li key={point.month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-[0.78rem] tabular-nums text-[var(--ar-text-muted)]">
                    {point.month}
                  </span>
                  <span className="h-2.5 flex-1 rounded-full bg-[var(--ar-body-bg)]">
                    <span
                      className="block h-full rounded-full bg-[var(--ar-primary)]"
                      style={{
                        width: `${Math.round((point.prescriptions / peak) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-[0.78rem] tabular-nums">
                    {point.prescriptions}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="What they sell most" subtitle="By prescriptions written." />
          {profile.topMedications.length === 0 ? (
            <EmptyState title="Nothing prescribed yet" hint="" />
          ) : (
            <ul className="divide-y divide-[var(--ar-border)]">
              {profile.topMedications.map((medication) => (
                <li
                  key={medication.medicationId}
                  className="flex items-baseline justify-between py-2"
                >
                  <span>
                    {medication.name}
                    {medication.isCompounded ? (
                      <span className="ml-2 text-[0.72rem] text-[var(--ar-text-faint)]">
                        compounded
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-[var(--ar-text-muted)]">
                    {medication.prescriptions}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <div className="p-6 pb-0">
          <CardHeader
            title="Recent prescriptions"
            subtitle="The last ten written under this account."
          />
        </div>
        {profile.recentPrescriptions.length === 0 ? (
          <EmptyState title="Nothing signed yet" hint="" />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">Medication</th>
                <th scope="col">Patient</th>
                <th scope="col">Prescriber</th>
                <th scope="col">Status</th>
                <th scope="col">Signed</th>
              </tr>
            </thead>
            <tbody>
              {profile.recentPrescriptions.map((rx) => (
                <tr key={rx.id}>
                  <td className="font-medium">{rx.medication}</td>
                  <td>
                    {rx.patient}
                    <span className="block text-[0.75rem] tabular-nums text-[var(--ar-text-faint)]">
                      {rx.mrn}
                    </span>
                  </td>
                  <td>{rx.prescriber}</td>
                  <td>
                    <Badge tone={statusTone(rx.status)}>{rx.status.toLowerCase()}</Badge>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{formatDateShort(rx.signedAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <ApiAccessPanel base={`v1/super-admin/admins/${tenant.id}`} />

      <WebhookPanel tenantId={tenant.id} />

      <Card>
        <CardHeader
          title="History"
          subtitle="Every change made to this account, by whom, and when."
          action={
            <Link
              href={`/super-admin/activity?entityType=Tenant&entityId=${tenant.id}`}
              className="text-[0.8rem] font-medium"
            >
              Open in the full log →
            </Link>
          }
        />
        <ActivityFeed entries={history} dense />
      </Card>
    </div>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
        {term}
      </dt>
      <dd className="mt-0.5 text-[0.9rem] text-[var(--ar-body-color)]">{value}</dd>
    </div>
  );
}

function pipelineSummary(pipeline: Record<string, number>): string {
  const open = Object.entries(pipeline)
    .filter(([status]) =>
      ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'PENDING_ASSIGNMENT'].includes(status),
    )
    .reduce((sum, [, count]) => sum + count, 0);
  return open ? `${open} still open` : 'none open';
}
