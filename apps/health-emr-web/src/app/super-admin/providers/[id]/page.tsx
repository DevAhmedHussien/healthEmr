import Link from 'next/link';
import { BarChartIcon, CheckCircleIcon, CreditCardIcon, RxPadIcon } from '@/components/ui/icons';
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
import { ActionDialog } from '@/components/admin/action-dialog';
import { EditPanel } from '@/components/admin/edit-panel';
import { ActivityFeed, type ActivityEntryView } from '@/components/admin/activity-feed';
import { Stat } from '@/components/ui/stat';
import { DocumentViewer, type ViewableDocument } from '@/components/onboarding/document-viewer';
import { formatDateShort, formatDateTime } from '@/lib/format';
import { LicenceTable } from './licence-table';
import { AddLicence } from '@/components/admin/licence-editor';
import { ActivityPanel } from '@/components/charts/activity-panel';

interface ProviderProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  credentials: string;
  npi: string | null;
  deaNumber: string | null;
  specialties: string[];
  bio: string | null;
  status: string;
  suspendedReason: string | null;
  isAcceptingRequests: boolean;
  maxOpenRequests: number;
  lastLoginAt: string | null;
  joinedAt: string;
  assignedAdmin: { id: string; name: string } | null;
  contractedAdmins: Array<{ id: string; name: string }>;
  licenses: Array<{
    id: string;
    state: string;
    licenseNumber: string;
    status: string;
    expiresAt: string;
  }>;
  categories: Array<{ slug: string; name: string }>;
  performance: {
    approved: number;
    refused: number;
    approvalRate: number | null;
    avgDecisionMinutes: number | null;
    earnings: Array<{ status: string; count: number; amountCents: number }>;
  };
  documents: ViewableDocument[];
  recentDecisions: Array<{
    id: string;
    masterId: string;
    status: string;
    category: string;
    tenant: string;
    patient: string;
    mrn: string;
    decidedAt: string;
  }>;
}

const duration = (minutes: number | null) => {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 6) / 10}h`;
  return `${Math.round(minutes / 144) / 10}d`;
};

export default async function ProviderProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [provider, history] = await Promise.all([
    serverApi<ProviderProfile>(`v1/super-admin/providers/${id}`).catch(swallow(null)),
    serverApi<ActivityEntryView[]>(`v1/super-admin/activity/ProviderProfile/${id}`).catch(swallow([] as ActivityEntryView[])),
  ]);
  if (!provider) notFound();

  const owed = provider.performance.earnings
    .filter((row) => row.status !== 'PAID')
    .reduce((sum, row) => sum + row.amountCents, 0);
  const paid = provider.performance.earnings
    .filter((row) => row.status === 'PAID')
    .reduce((sum, row) => sum + row.amountCents, 0);
  const reviews = provider.performance.approved + provider.performance.refused;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/providers" className="text-[0.8rem] font-medium">
            ← Providers
          </Link>
          <h2 className="mt-1">
            {provider.name}, {provider.credentials}
          </h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {provider.email}
            {provider.phone ? ` · ${provider.phone}` : ''} · joined{' '}
            {formatDateShort(provider.joinedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(provider.status)}>{provider.status.toLowerCase()}</Badge>
          {!provider.isAcceptingRequests ? <Badge tone="warning">not accepting</Badge> : null}
          {provider.status === 'ARCHIVED' ? (
            <ActionDialog
              label="Restore provider"
              icon="restore"
              description={[
                "Reactivates this clinician's account.",
                "They will not be routed new work until they are put back on a client's roster.",
              ]}
              path={`v1/super-admin/providers/${provider.id}/restore`}
              variant="primary"
              successMessage="Provider restored."
            />
          ) : (
            <ActionDialog
              label="Archive provider"
              icon="archive"
              description={[
                'Takes this clinician off the platform and ends their client contracts.',
                'Refused while they hold open visits.',
                'Prescriptions they signed are retained — nothing clinical is deleted, and this can be undone.',
              ]}
              path={`v1/super-admin/providers/${provider.id}`}
              method="DELETE"
              variant="danger"
              confirmLabel="Archive"
              successMessage="Provider archived."
            />
          )}
        </div>
      </div>

      {provider.suspendedReason ? (
        <div className="rounded-[var(--ar-radius)] border-l-4 border-[var(--ar-danger)] bg-[var(--ar-danger-soft)] px-4 py-3 text-[0.9rem] text-[var(--ar-on-danger)]">
          Suspended: {provider.suspendedReason}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Reviews completed" value={reviews} tone="primary" icon={CheckCircleIcon} />
        <Stat
          label="Approved / refused"
          icon={RxPadIcon}
          value={`${provider.performance.approved} / ${provider.performance.refused}`}
          tone="info"
        />
        <Stat
          label="Approval rate"
          icon={BarChartIcon}
          value={
            provider.performance.approvalRate === null
              ? '—'
              : `${provider.performance.approvalRate}%`
          }
          sub={`avg decision ${duration(provider.performance.avgDecisionMinutes)}`}
          tone="success"
        />
        <Stat
          label="Payable"
          icon={CreditCardIcon}
          value={`$${(owed / 100).toFixed(2)}`}
          sub={`$${(paid / 100).toFixed(2)} paid`}
          tone="danger"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <ActivityPanel
            path={`v1/super-admin/providers/${provider.id}/activity`}
            title="Hours worked"
            subtitle="Active time per day, worked out from recorded actions rather than a session timer."
          />

          <Card>
            <CardHeader
              title="State licences"
              subtitle="Routing only ever offers a visit to a provider holding a current licence in the patient's state."
              action={
                <AddLicence
                  providerId={provider.id}
                  held={provider.licenses.map((licence) => licence.state)}
                  scope="platform"
                />
              }
            />
            <LicenceTable licences={provider.licenses} providerId={provider.id} />
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              subtitle={`${provider.documents.length} on file — the evidence behind each licence row`}
            />
            <DocumentViewer scope="provider" documents={provider.documents} />
          </Card>

          <Card>
            <CardHeader
              title="Recent decisions"
              subtitle="The last 20 visits this provider closed"
            />
            {provider.recentDecisions.length === 0 ? (
              <EmptyState title="No decisions yet" />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Visit</th>
                    <th>Patient</th>
                    <th>Account</th>
                    <th>Category</th>
                    <th>Decided</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {provider.recentDecisions.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium">{row.masterId}</td>
                      <td>
                        {row.patient}
                        <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                          {row.mrn}
                        </span>
                      </td>
                      <td>{row.tenant}</td>
                      <td>{row.category}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDateShort(row.decidedAt)}
                      </td>
                      <td>
                        <Badge tone={statusTone(row.status)}>{row.status.toLowerCase()}</Badge>
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
            <CardHeader title="Identity" />
            <dl className="space-y-2.5 text-[0.875rem]">
              {[
                ['NPI', provider.npi ?? '—'],
                ['DEA', provider.deaNumber ?? '—'],
                ['Specialties', provider.specialties.join(', ') || '—'],
                ['Queue capacity', String(provider.maxOpenRequests)],
                [
                  'Last sign-in',
                  provider.lastLoginAt ? formatDateTime(provider.lastLoginAt) : 'never',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-[var(--ar-text-muted)]">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Categories" subtitle="What this provider is qualified to review" />
            <div className="flex flex-wrap gap-1.5">
              {provider.categories.map((category) => (
                <Badge key={category.slug} tone="primary">
                  {category.name}
                </Badge>
              ))}
              {provider.categories.length === 0 ? (
                <span className="text-[0.85rem] text-[var(--ar-text-muted)]">None</span>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Admin accounts" subtitle="Businesses this provider serves" />
            <div className="space-y-1.5 text-[0.875rem]">
              {provider.assignedAdmin ? (
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/super-admin/admins/${provider.assignedAdmin.id}`}>
                    {provider.assignedAdmin.name}
                  </Link>
                  <Badge tone="success">primary</Badge>
                </div>
              ) : null}
              {provider.contractedAdmins
                .filter((admin) => admin.id !== provider.assignedAdmin?.id)
                .map((admin) => (
                  <div key={admin.id} className="flex items-center justify-between gap-2">
                    <Link href={`/super-admin/admins/${admin.id}`}>{admin.name}</Link>
                    <Badge tone="neutral">contracted</Badge>
                  </div>
                ))}
              {provider.contractedAdmins.length === 0 && !provider.assignedAdmin ? (
                <p className="text-[var(--ar-text-muted)]">Not contracted to any account yet.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Profile"
          subtitle="Changes here are recorded against this clinician."
          action={
            <EditPanel
              title="Edit provider"
              path={`v1/super-admin/providers/${provider.id}`}
              fields={[
                {
                  name: 'credentials',
                  label: 'Credentials',
                  value: provider.credentials,
                },
                {
                  name: 'npi',
                  label: 'NPI',
                  value: provider.npi,
                  hint: '10 digits',
                  type: 'npi',
                },
                {
                  name: 'maxOpenRequests',
                  label: 'Queue capacity',
                  value: provider.maxOpenRequests,
                  type: 'number',
                  hint: 'How many visits they may hold at once.',
                },
                {
                  name: 'isAcceptingRequests',
                  label: 'Accepting new visits',
                  value: String(provider.isAcceptingRequests),
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
          subtitle="Every change made to this provider, by whom, and when."
          action={
            <Link
              href={`/super-admin/activity?entityType=ProviderProfile&entityId=${provider.id}`}
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
