import Link from 'next/link';
import { CreditCardIcon, PackageIcon, PillIcon, PulseIcon } from '@/components/ui/icons';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { Catalog } from '@/app/dispensary/catalog/catalog';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  TableWrap,
  statusTone,
} from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import { DocumentViewer, type ViewableDocument } from '@/components/onboarding/document-viewer';
import { ActionDialog } from '@/components/admin/action-dialog';
import { EditPanel } from '@/components/admin/edit-panel';
import { ActivityFeed, type ActivityEntryView } from '@/components/admin/activity-feed';
import { IntegrationPanel } from '@/components/admin/integration-panel';
import { formatDateShort, formatMoney } from '@/lib/format';

interface Product {
  id: string;
  kitCode: string;
  favouriteName: string;
  medicationName: string;
  concentration: string | null;
  form: string;
  vialSize: string | null;
  daysSupply: number | null;
  costOfGoodsCents: number | null;
  isActive: boolean;
  linkedMedication: { medId: string; name: string } | null;
}

interface PharmacyProfile {
  id: string;
  name: string;
  slug: string;
  integrationType: string;
  ncpdpId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  dispensesCompounded: boolean;
  dispensesBranded: boolean;
  status: string;
  suspendedReason: string | null;
  joinedAt: string;
  assignedAdmin: { id: string; name: string } | null;
  contractedAdmins: Array<{ id: string; name: string }>;
  integration: {
    baseUrl: string;
    authStrategy: string;
    credentialRef: string;
    timeoutMs: number;
  } | null;
  performance: {
    ordersThisMonth: number;
    shipped: number;
    avgFulfilmentHours: number | null;
  };
  catalogue: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isActive: boolean;
    clinicalCategory: { slug: string; name: string } | null;
    products: Product[];
  }>;
  catalogueSummary: {
    categories: number;
    products: number;
    priced: number;
    totalCostOfGoodsCents: number;
    averageCostOfGoodsCents: number | null;
  };
  documents: ViewableDocument[];
  recentOrders: Array<{
    id: string;
    status: string;
    medication: string;
    dose: string;
    quantity: string;
    mrn: string;
    tenant: string;
    costOfGoodsCents: number | null;
    carrier: string | null;
    trackingNumber: string | null;
    createdAt: string;
  }>;
}

export default async function PharmacyProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pharmacy, history] = await Promise.all([
    serverApi<PharmacyProfile>(`v1/super-admin/pharmacies/${id}`).catch(() => null),
    serverApi<ActivityEntryView[]>(`v1/super-admin/activity/Pharmacy/${id}`).catch(
      () => [] as ActivityEntryView[],
    ),
  ]);
  if (!pharmacy) notFound();

  const summary = pharmacy.catalogueSummary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/pharmacies" className="text-[0.8rem] font-medium">
            ← Pharmacies
          </Link>
          <h2 className="mt-1">{pharmacy.name}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {pharmacy.slug} · {pharmacy.contactEmail ?? 'no contact email'} · joined{' '}
            {formatDateShort(pharmacy.joinedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(pharmacy.status)}>{pharmacy.status.toLowerCase()}</Badge>
          <Badge tone="primary">{pharmacy.integrationType}</Badge>
          {pharmacy.dispensesCompounded ? <Badge tone="info">compounded</Badge> : null}
          {pharmacy.dispensesBranded ? <Badge tone="info">branded</Badge> : null}
          {pharmacy.status === 'ARCHIVED' ? (
            <ActionDialog
              label="Restore pharmacy"
              icon="restore"
              description={[
                'Reactivates this pharmacy and its staff accounts.',
                "It must be added back to a client's roster before it can receive orders.",
              ]}
              path={`v1/super-admin/pharmacies/${pharmacy.id}/restore`}
              variant="primary"
              successMessage="Pharmacy restored."
            />
          ) : (
            <ActionDialog
              label="Archive pharmacy"
              icon="archive"
              description={[
                'Takes this pharmacy off the platform, deactivates its staff and removes it from every client roster.',
                'Refused while any order is in flight.',
                'Its catalogue and order history are retained, and this can be undone.',
              ]}
              path={`v1/super-admin/pharmacies/${pharmacy.id}`}
              method="DELETE"
              variant="danger"
              confirmLabel="Archive"
              successMessage="Pharmacy archived."
            />
          )}
        </div>
      </div>

      {pharmacy.suspendedReason ? (
        <div className="rounded-[var(--ar-radius)] border-l-4 border-[var(--ar-danger)] bg-[var(--ar-danger-soft)] px-4 py-3 text-[0.9rem] text-[var(--ar-on-danger)]">
          Suspended: {pharmacy.suspendedReason}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Products"
          icon={PillIcon}
          value={summary.products}
          sub={`${summary.categories} categories`}
          tone="primary"
        />
        <Stat
          label="Average cost of goods"
          icon={CreditCardIcon}
          value={formatMoney(summary.averageCostOfGoodsCents)}
          sub={`${summary.priced} of ${summary.products} priced`}
          tone="warning"
        />
        <Stat
          label="Orders this month"
          value={pharmacy.performance.ordersThisMonth}
          tone="info"
          icon={PackageIcon}
        />
        <Stat
          label="Fulfilment time"
          icon={PulseIcon}
          value={
            pharmacy.performance.avgFulfilmentHours === null
              ? '—'
              : `${pharmacy.performance.avgFulfilmentHours}h`
          }
          sub={`${pharmacy.performance.shipped} shipped`}
          tone="success"
        />
      </div>

      {/* The editable catalogue, not a second read-only copy of it. Two views of
          one dataset are two things that can disagree, and the one nobody edits
          is the one that goes stale. */}
      <Catalog base={`v1/super-admin/pharmacies/${pharmacy.id}`} canPrice />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Documents" subtitle={`${pharmacy.documents.length} on file`} />
            <DocumentViewer scope="pharmacy" documents={pharmacy.documents} />
          </Card>

          <Card>
            <CardHeader title="Recent orders" subtitle="The last 20 sent to this pharmacy" />
            {pharmacy.recentOrders.length === 0 ? (
              <EmptyState title="No orders yet" />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Medication</th>
                    <th>Patient</th>
                    <th>Account</th>
                    <th>COGS</th>
                    <th>Tracking</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmacy.recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        {order.medication}
                        <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                          {order.dose} · qty {order.quantity}
                        </span>
                      </td>
                      <td className="tabular-nums">{order.mrn}</td>
                      <td>{order.tenant}</td>
                      <td className="tabular-nums">{formatMoney(order.costOfGoodsCents)}</td>
                      <td className="text-[0.78rem]">
                        {order.trackingNumber ? `${order.carrier} ${order.trackingNumber}` : '—'}
                      </td>
                      <td>
                        <Badge tone={statusTone(order.status)}>
                          {order.status.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Integration" />
            {pharmacy.integration ? (
              <dl className="space-y-2.5 text-[0.85rem]">
                {[
                  ['Platform', pharmacy.integrationType],
                  ['Base URL', pharmacy.integration.baseUrl],
                  ['Auth', pharmacy.integration.authStrategy],
                  ['Timeout', `${pharmacy.integration.timeoutMs}ms`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-[var(--ar-text-muted)]">{label}</dt>
                    <dd className="truncate text-right font-mono text-[0.78rem]">{value}</dd>
                  </div>
                ))}
                <div className="border-t border-[var(--ar-border-soft)] pt-2">
                  <dt className="text-[var(--ar-text-muted)]">Credential</dt>
                  <dd className="mt-0.5 break-all font-mono text-[0.72rem] text-[var(--ar-text-faint)]">
                    {pharmacy.integration.credentialRef}
                  </dd>
                  <p className="mt-1 text-[0.72rem] text-[var(--ar-text-faint)]">
                    A parameter-store path. The secret itself is never held here.
                  </p>
                </div>
              </dl>
            ) : (
              <p className="text-[0.85rem] text-[var(--ar-text-muted)]">
                No integration configured — nothing can be dispatched here yet.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-2.5 text-[0.875rem]">
              {[
                ['NCPDP', pharmacy.ncpdpId ?? '—'],
                ['Phone', pharmacy.contactPhone ?? '—'],
                ['Catalogue value', formatMoney(summary.totalCostOfGoodsCents)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-[var(--ar-text-muted)]">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Admin accounts" subtitle="Businesses contracted to this pharmacy" />
            <div className="space-y-1.5 text-[0.875rem]">
              {pharmacy.contractedAdmins.map((admin) => (
                <div key={admin.id} className="flex items-center justify-between gap-2">
                  <Link href={`/super-admin/admins/${admin.id}`}>{admin.name}</Link>
                  {admin.id === pharmacy.assignedAdmin?.id ? (
                    <Badge tone="success">primary</Badge>
                  ) : null}
                </div>
              ))}
              {pharmacy.contractedAdmins.length === 0 ? (
                <p className="text-[var(--ar-text-muted)]">Not contracted to any account yet.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
      <IntegrationPanel pharmacyId={pharmacy.id} pharmacyName={pharmacy.name} />

      <Card>
        <CardHeader
          title="Pharmacy details"
          subtitle="Contact and capability. Changing the contact address no longer affects who can sign in — staff are linked to the pharmacy itself."
          action={
            <EditPanel
              title="Edit pharmacy"
              path={`v1/super-admin/pharmacies/${pharmacy.id}`}
              reason="none"
              fields={[
                { name: 'name', label: 'Name', value: pharmacy.name },
                {
                  name: 'contactEmail',
                  label: 'Contact email',
                  value: pharmacy.contactEmail,
                  type: 'email',
                },
                {
                  name: 'contactPhone',
                  label: 'Contact phone',
                  value: pharmacy.contactPhone,
                  type: 'phone',
                },
                { name: 'ncpdpId', label: 'NCPDP ID', value: pharmacy.ncpdpId },
                {
                  name: 'dispensesCompounded',
                  label: 'Dispenses compounded',
                  value: String(pharmacy.dispensesCompounded),
                  type: 'checkbox',
                },
                {
                  name: 'dispensesBranded',
                  label: 'Dispenses branded',
                  value: String(pharmacy.dispensesBranded),
                  type: 'checkbox',
                },
              ]}
            />
          }
        />
      </Card>

      <Card>
        <CardHeader
          title="History"
          subtitle="Every change made to this pharmacy and its catalogue, by whom, and when."
          action={
            <Link
              href={`/super-admin/activity?entityType=Pharmacy&entityId=${pharmacy.id}`}
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
