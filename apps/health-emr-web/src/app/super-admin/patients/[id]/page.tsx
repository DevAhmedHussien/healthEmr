import Link from 'next/link';
import {
  AlertTriangleIcon,
  CreditCardIcon,
  PackageIcon,
  PillIcon,
  PulseIcon,
} from '@/components/ui/icons';
import { notFound } from 'next/navigation';
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
import { Stat } from '@/components/ui/stat';
import { formatDateShort, formatDateTime, formatMoney } from '@/lib/format';
import { ActionDialog } from '@/components/admin/action-dialog';

interface PatientRecord {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sexAtBirth: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
  hasLogin: boolean;
  loginActive: boolean;
  lastLoginAt: string | null;
  idPhotoOnFile: boolean;
  createdAt: string;
  accounts: Array<{ id: string; name: string; slug: string }>;
  allergies: Array<{
    id: string;
    substance: string;
    severity: string;
    reactionText: string | null;
    status: string;
  }>;
  conditions: Array<{
    id: string;
    display: string;
    clinicalStatus: string;
    onsetDate: string | null;
  }>;
  medications: Array<{
    id: string;
    nameText: string;
    dose: string | null;
    frequency: string | null;
    status: string;
    source: string;
  }>;
  vitals: Array<{
    id: string;
    heightIn: string | null;
    weightLbs: string | null;
    bmi: string | null;
    recordedAt: string;
  }>;
  labResults: Array<{
    id: string;
    testName: string;
    testResult: string;
    testResultUnits: string | null;
    statusIndicator: string;
    screeningDate: string;
  }>;
  visits: Array<{
    id: string;
    masterId: string;
    status: string;
    category: string;
    tenant: string;
    provider: string | null;
    submittedAt: string;
    decidedAt: string | null;
    items: Array<{ id: string; name: string; decision: string; reason: string | null }>;
  }>;
  prescriptions: Array<{
    id: string;
    medication: string;
    dose: string;
    quantity: string;
    refills: number;
    directions: string;
    status: string;
    signedAt: string;
    prescriber: string;
    licence: string;
    orders: Array<{
      id: string;
      pharmacy: string;
      status: string;
      carrier: string | null;
      trackingNumber: string | null;
    }>;
    invoice: {
      id: string;
      number: string;
      status: string;
      totalCents: number;
    } | null;
  }>;
  billing: {
    invoices: number;
    billedCents: number;
    paidCents: number;
    voidedCents: number;
  };
}

export default async function PatientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = await serverApi<PatientRecord>(`v1/super-admin/patients/${id}`).catch(() => null);
  if (!patient) notFound();

  const activeAllergies = patient.allergies.filter((a) => a.status === 'ACTIVE');
  const latestVitals = patient.vitals[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/patients" className="text-[0.8rem] font-medium">
            ← Patients
          </Link>
          <h2 className="mt-1">
            {patient.firstName} {patient.lastName}
          </h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {patient.mrn} · born {patient.dateOfBirth} · {patient.sexAtBirth.toLowerCase()} ·{' '}
            {patient.address.city}, {patient.address.state}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {patient.accounts.map((account) => (
            <Badge key={account.id} tone="primary">
              {account.name}
            </Badge>
          ))}
          <Badge tone={patient.loginActive ? 'success' : 'neutral'}>
            {patient.hasLogin
              ? patient.loginActive
                ? 'portal active'
                : 'invite pending'
              : 'no login'}
          </Badge>
        </div>
      </div>

      <Alert tone="warning">
        Opening a complete patient record has been recorded in the audit log as break-the-glass
        access.
      </Alert>

      {activeAllergies.length > 0 ? (
        <div className="rounded-[var(--ar-radius)] border-l-4 border-[var(--ar-warning)] bg-[var(--ar-warning-soft)] px-4 py-3">
          <p className="text-[0.9rem] font-semibold text-[#92400E]">
            Allergies: {activeAllergies.map((a) => a.substance).join(', ')}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Visits" value={patient.visits.length} tone="primary" icon={PackageIcon} />
        <Stat
          label="Prescriptions"
          value={patient.prescriptions.length}
          tone="success"
          icon={PillIcon}
        />
        <Stat
          label="Active allergies"
          icon={AlertTriangleIcon}
          value={activeAllergies.length}
          tone={activeAllergies.length ? 'warning' : 'info'}
        />
        <Stat
          label="Billed"
          icon={CreditCardIcon}
          value={formatMoney(patient.billing.billedCents)}
          sub={
            patient.billing.invoices
              ? `${formatMoney(patient.billing.paidCents)} paid across ${patient.billing.invoices} invoice${patient.billing.invoices === 1 ? '' : 's'}`
              : 'nothing invoiced yet'
          }
          tone="primary"
        />
        <Stat
          label="Latest BMI"
          icon={PulseIcon}
          value={latestVitals?.bmi ?? '—'}
          sub={latestVitals ? `${latestVitals.weightLbs ?? '—'} lbs` : 'no vitals recorded'}
          tone="info"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card className="p-0">
            <div className="p-6 pb-0">
              <CardHeader
                title="Visits"
                subtitle="Every questionnaire this patient has submitted"
              />
            </div>
            {patient.visits.length === 0 ? (
              <EmptyState title="No visits" />
            ) : (
              <div className="px-6 pb-6">
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Category</th>
                      <th>Account</th>
                      <th>Reviewed by</th>
                      <th>Lines</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {patient.visits.map((visit) => (
                      <tr key={visit.id}>
                        <td className="font-medium">{visit.masterId}</td>
                        <td>{visit.category}</td>
                        <td>{visit.tenant}</td>
                        <td>
                          {visit.provider ?? (
                            <span className="text-[var(--ar-text-faint)]">unassigned</span>
                          )}
                        </td>
                        <td>
                          {visit.items.map((item) => (
                            <span key={item.id} className="block text-[0.78rem]">
                              {item.name} · {item.decision.toLowerCase()}
                            </span>
                          ))}
                        </td>
                        <td>
                          <Badge tone={statusTone(visit.status)}>
                            {visit.status.replace(/_/g, ' ').toLowerCase()}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <Link
                            href={`/super-admin/visits/${visit.id}/questionnaire`}
                            className="whitespace-nowrap font-medium"
                          >
                            View QA →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            )}
          </Card>

          <Card className="p-0">
            <div className="p-6 pb-0">
              <CardHeader title="Prescriptions" subtitle="With the licence each was signed under" />
            </div>
            {patient.prescriptions.length === 0 ? (
              <EmptyState title="No prescriptions" />
            ) : (
              <div className="space-y-3 px-6 pb-6">
                {patient.prescriptions.map((prescription) => (
                  <div
                    key={prescription.id}
                    className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--ar-headings)]">
                          {prescription.medication}
                        </p>
                        <p className="text-[0.8rem] text-[var(--ar-text-muted)]">
                          {prescription.dose} · qty {prescription.quantity} · {prescription.refills}{' '}
                          refills
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Badge tone={statusTone(prescription.status)}>
                          {prescription.status.toLowerCase()}
                        </Badge>
                        {prescription.invoice ? (
                          <Link
                            href={`/super-admin/invoices/${prescription.invoice.id}`}
                            className="whitespace-nowrap text-[0.75rem] font-medium"
                          >
                            {prescription.invoice.number} ·{' '}
                            {formatMoney(prescription.invoice.totalCents)}
                          </Link>
                        ) : (
                          <ActionDialog
                            label="Raise invoice"
                            icon="invoice"
                            description={[
                              'Builds a draft invoice from the price the client business quoted for this line at intake.',
                              'Nothing is sent until it is issued.',
                            ]}
                            path={`v1/super-admin/prescriptions/${prescription.id}/invoice`}
                            requireReason={false}
                            variant="ghost"
                            confirmLabel="Raise draft invoice"
                            successMessage="Draft invoice raised."
                          />
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-[0.85rem]">{prescription.directions}</p>
                    <p className="mt-2 text-[0.75rem] text-[var(--ar-text-faint)]">
                      {prescription.prescriber} · {prescription.licence} ·{' '}
                      {formatDateShort(prescription.signedAt)}
                    </p>
                    {prescription.orders.map((order) => (
                      <div
                        key={order.id}
                        className="mt-2 rounded-[var(--ar-radius)] bg-[var(--ar-gray-50)] px-3 py-2 text-[0.8rem]"
                      >
                        {order.pharmacy} · {order.status.replace(/_/g, ' ').toLowerCase()}
                        {order.trackingNumber ? ` · ${order.carrier} ${order.trackingNumber}` : ''}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {patient.labResults.length > 0 ? (
            <Card className="p-0">
              <div className="p-6 pb-0">
                <CardHeader title="Lab results" />
              </div>
              <div className="px-6 pb-6">
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Result</th>
                      <th>Flag</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patient.labResults.map((lab) => (
                      <tr key={lab.id}>
                        <td>{lab.testName}</td>
                        <td className="tabular-nums">
                          {lab.testResult} {lab.testResultUnits ?? ''}
                        </td>
                        <td>
                          <Badge tone={lab.statusIndicator === 'N' ? 'success' : 'warning'}>
                            {lab.statusIndicator}
                          </Badge>
                        </td>
                        <td className="tabular-nums">{formatDateShort(lab.screeningDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            <dl className="space-y-2.5 text-[0.875rem]">
              {[
                ['Email', patient.email],
                ['Phone', patient.phone],
                [
                  'Address',
                  `${patient.address.line1}, ${patient.address.city} ${patient.address.state} ${patient.address.postalCode}`,
                ],
                ['ID photo', patient.idPhotoOnFile ? 'on file' : 'not supplied'],
                [
                  'Last sign-in',
                  patient.lastLoginAt ? formatDateTime(patient.lastLoginAt) : 'never',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ar-text-faint)]">
                    {label}
                  </dt>
                  <dd className="mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Allergies" />
            {patient.allergies.length === 0 ? (
              <p className="text-[0.85rem] text-[var(--ar-text-muted)]">None recorded.</p>
            ) : (
              <ul className="space-y-2 text-[0.875rem]">
                {patient.allergies.map((allergy) => (
                  <li key={allergy.id}>
                    <span className="font-medium">{allergy.substance}</span>
                    <span className="ml-2 text-[0.72rem] text-[var(--ar-text-faint)]">
                      {allergy.severity.toLowerCase()}
                    </span>
                    {allergy.reactionText ? (
                      <span className="block text-[0.75rem] text-[var(--ar-text-muted)]">
                        {allergy.reactionText}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Conditions" />
            {patient.conditions.length === 0 ? (
              <p className="text-[0.85rem] text-[var(--ar-text-muted)]">None recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-[0.875rem]">
                {patient.conditions.map((condition) => (
                  <li key={condition.id} className="flex items-center justify-between gap-2">
                    <span>{condition.display}</span>
                    <Badge tone={statusTone(condition.clinicalStatus)}>
                      {condition.clinicalStatus.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Medications" />
            {patient.medications.length === 0 ? (
              <p className="text-[0.85rem] text-[var(--ar-text-muted)]">None recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-[0.875rem]">
                {patient.medications.map((medication) => (
                  <li key={medication.id}>
                    <span>{medication.nameText}</span>
                    <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                      {medication.source.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
