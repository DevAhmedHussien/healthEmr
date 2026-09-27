import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VISIT_STAGE_MEANING, type VisitStage } from '@health-emr/types';
import { serverApi, swallow } from '@/lib/server-api';
import { Alert, Badge, Card, CardHeader, TableWrap, statusTone } from '@/components/ui/primitives';
import { StageBadge } from '@/components/portal/stage-badge';
import { formatDateTime, formatDob, formatMoney, formatPhone } from '@/lib/format';
import { VisitPhotos } from '@/components/portal/visit-photos';
import { Timeline } from './timeline';

export const metadata = { title: 'Visit — HealthEMR' };

interface Visit {
  id: string;
  masterId: string;
  stage: VisitStage;
  requestStatus: string;
  category: { slug: string; name: string };
  submittedAt: string;
  decidedAt: string | null;
  refusedReason: string | null;
  provider: string | null;
  patientState: string;
  patient: {
    id: string;
    mrn: string;
    name: string;
    dateOfBirth: string;
    sexAtBirth: string;
    email: string;
    phone: string;
    shipTo: string;
  };
  clinical: {
    allergies: { substance: string; severity: string; reaction: string | null }[];
    conditions: string[];
    medications: string[];
  } | null;
  questionnaire: {
    name: string;
    version: number;
    answers: { questionId: string; question: string; answer: string }[];
  } | null;
  photos: {
    id: string;
    kind: string;
    mime: string;
    size: number;
    fileName: string;
    uploadedAt: string;
  }[];
  requested: {
    id: string;
    name: string;
    strength: string | null;
    quantity: string | null;
    refills: number | null;
    daysSupply: number | null;
    kitCode: string | null;
    decision: string;
  }[];
  prescriptions: {
    id: string;
    medication: string;
    strength: string | null;
    dose: string;
    quantity: string;
    refills: number;
    sig: string;
    status: string;
    signedAt: string;
    prescriber: string;
    licence: string;
    invoice: { id: string; number: string; status: string; totalCents: number } | null;
    orders: {
      id: string;
      pharmacy: string;
      status: string;
      carrier: string | null;
      trackingNumber: string | null;
      submittedAt: string | null;
      shippedAt: string | null;
      deliveredAt: string | null;
      attempts: number;
      error: string | null;
    }[];
  }[];
  redactedSections: string[];
}

/**
 * Splits a question of the form
 *   "Have you taken X? POSSIBLE ANSWERS: a; b; c"
 * into the question and its options, which is how the partner contract encodes
 * multiple choice.
 */
function splitQuestion(text: string): { question: string; options: string[] } {
  const marker = 'POSSIBLE ANSWERS:';
  const index = text.indexOf(marker);
  if (index === -1) return { question: text, options: [] };
  return {
    question: text.slice(0, index).trim(),
    options: text
      .slice(index + marker.length)
      .split(';')
      .map((option) => option.trim())
      .filter(Boolean),
  };
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.72rem] uppercase tracking-wide text-[var(--ar-text-faint)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-[0.9rem] text-[var(--ar-body-color)]">{value}</dd>
    </div>
  );
}

export default async function AdminVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const visit = await serverApi<Visit>(`v1/admin/visits/${id}`).catch(swallow(null));
  if (!visit) notFound();

  const stuck = visit.stage === 'STUCK';
  const transmissionError = visit.prescriptions
    .flatMap((prescription) => prescription.orders)
    .find((order) => order.error)?.error;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/visits" className="text-[0.8rem] font-medium">
            ← Visits
          </Link>
          <h2 className="mt-1">{visit.patient.name}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {visit.category.name} · order {visit.masterId} · submitted{' '}
            {formatDateTime(visit.submittedAt)}
          </p>
        </div>
        <div className="text-right">
          <StageBadge stage={visit.stage} />
          <p className="mt-1 max-w-[22rem] text-[0.78rem] text-[var(--ar-text-muted)]">
            {VISIT_STAGE_MEANING[visit.stage]}
          </p>
        </div>
      </div>

      {stuck ? (
        <Alert tone="danger">
          <strong>This order is not moving.</strong>{' '}
          {transmissionError
            ? `The pharmacy never received it: ${transmissionError}`
            : 'It was approved but has not reached the pharmacy.'}{' '}
          Your account manager can route it to another pharmacy.
        </Alert>
      ) : null}

      {visit.stage === 'REFUSED' && visit.refusedReason ? (
        <Alert tone="warning">
          <strong>A clinician did not approve this.</strong> {visit.refusedReason}
        </Alert>
      ) : null}

      <Timeline
        stage={visit.stage}
        submittedAt={visit.submittedAt}
        decidedAt={visit.decidedAt}
        orders={visit.prescriptions.flatMap((prescription) => prescription.orders)}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="What was requested" />
            <TableWrap>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Strength</th>
                  <th>Quantity</th>
                  <th>Days supply</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {visit.requested.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.name}</td>
                    <td>{item.strength ?? '—'}</td>
                    <td>{item.quantity ?? '—'}</td>
                    <td>{item.daysSupply ?? '—'}</td>
                    <td>
                      <Badge tone={statusTone(item.decision)}>
                        {item.decision.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>

          {visit.prescriptions.length > 0 ? (
            <Card>
              <CardHeader title="Prescribed" subtitle="Signed by a licensed clinician" />
              <div className="space-y-4">
                {visit.prescriptions.map((prescription) => (
                  <div
                    key={prescription.id}
                    className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--ar-headings)]">
                          {prescription.medication} {prescription.strength}
                        </p>
                        <p className="text-[0.8rem] text-[var(--ar-text-muted)]">
                          {prescription.dose} · qty {prescription.quantity} · {prescription.refills}{' '}
                          refills
                        </p>
                      </div>
                      <Badge tone={statusTone(prescription.status)}>
                        {prescription.status.toLowerCase()}
                      </Badge>
                    </div>

                    <p className="mt-2 text-[0.85rem] text-[var(--ar-body-color)]">
                      {prescription.sig}
                    </p>

                    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Detail label="Prescriber" value={prescription.prescriber} />
                      <Detail label="Licence" value={prescription.licence} />
                      <Detail label="Signed" value={formatDateTime(prescription.signedAt)} />
                      <Detail
                        label="Billed"
                        value={
                          prescription.invoice
                            ? formatMoney(prescription.invoice.totalCents)
                            : 'not invoiced'
                        }
                      />
                    </dl>

                    {prescription.orders.length > 0 ? (
                      <div className="mt-3 space-y-2 border-t border-[var(--ar-border)] pt-3">
                        {prescription.orders.map((order) => (
                          <div key={order.id} className="text-[0.82rem]">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={statusTone(order.status)}>
                                {order.status.replace(/_/g, ' ').toLowerCase()}
                              </Badge>
                              <span className="text-[var(--ar-body-color)]">{order.pharmacy}</span>
                              {order.trackingNumber ? (
                                <span className="tabular-nums text-[var(--ar-text-muted)]">
                                  {order.carrier} {order.trackingNumber}
                                </span>
                              ) : null}
                            </div>
                            {order.error ? (
                              <p className="mt-1 text-[0.78rem] text-[var(--ar-danger)]">
                                {order.error} — {order.attempts} attempt
                                {order.attempts === 1 ? '' : 's'}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {visit.questionnaire ? (
            <Card>
              <CardHeader
                title="Intake questionnaire"
                subtitle={`${visit.questionnaire.name} · version ${visit.questionnaire.version}`}
              />
              <Alert tone="info">
                This is the patient&rsquo;s own account of their health, which they gave you at
                intake. Opening it has been recorded against their chart.
              </Alert>
              <dl className="mt-4 space-y-3">
                {visit.questionnaire.answers.map((answer) => {
                  const { question, options } = splitQuestion(answer.question);
                  return (
                    <div
                      key={answer.questionId}
                      className="border-b border-[var(--ar-border)] pb-3 last:border-0 last:pb-0"
                    >
                      <dt className="text-[0.85rem] font-medium text-[var(--ar-headings)]">
                        {question}
                      </dt>
                      <dd className="mt-1 text-[0.9rem] text-[var(--ar-body-color)]">
                        {answer.answer || (
                          <span className="text-[var(--ar-text-faint)]">no answer</span>
                        )}
                      </dd>
                      {options.length > 0 ? (
                        <dd className="mt-1 text-[0.72rem] text-[var(--ar-text-faint)]">
                          offered: {options.join(' · ')}
                        </dd>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            </Card>
          ) : null}

          {visit.photos.length > 0 ? (
            <VisitPhotos
              endpoint={`/api/bff/v1/admin/visits/${visit.id}/photos/{id}`}
              photos={visit.photos}
            />
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Patient" />
            <dl className="space-y-3">
              <Detail
                label="Record number"
                value={<span className="tabular-nums">{visit.patient.mrn}</span>}
              />
              <Detail label="Date of birth" value={formatDob(visit.patient.dateOfBirth)} />
              <Detail label="Sex at birth" value={visit.patient.sexAtBirth.toLowerCase()} />
              <Detail label="Email" value={visit.patient.email} />
              <Detail label="Phone" value={formatPhone(visit.patient.phone)} />
              <Detail label="Ship to" value={visit.patient.shipTo} />
              <Detail
                label="State at submission"
                value={`${visit.patientState} — the state licensure follows`}
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Review" />
            <dl className="space-y-3">
              <Detail label="Clinician" value={visit.provider ?? 'not yet assigned'} />
              <Detail
                label="Decided"
                value={visit.decidedAt ? formatDateTime(visit.decidedAt) : 'not yet'}
              />
              <Detail
                label="Record status"
                value={
                  <Badge tone={statusTone(visit.requestStatus)}>
                    {visit.requestStatus.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                }
              />
            </dl>
          </Card>

          {visit.clinical ? (
            <Card>
              <CardHeader title="Clinical history" subtitle="As the patient reported it" />
              <div className="space-y-3 text-[0.85rem]">
                <div>
                  <p className="text-[0.72rem] uppercase tracking-wide text-[var(--ar-text-faint)]">
                    Allergies
                  </p>
                  {visit.clinical.allergies.length > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {visit.clinical.allergies.map((allergy) => (
                        <li key={allergy.substance}>
                          {allergy.substance}
                          <span className="text-[var(--ar-text-faint)]">
                            {' '}
                            · {allergy.severity.toLowerCase()}
                            {allergy.reaction ? ` · ${allergy.reaction}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[var(--ar-text-faint)]">none reported</p>
                  )}
                </div>
                <div>
                  <p className="text-[0.72rem] uppercase tracking-wide text-[var(--ar-text-faint)]">
                    Conditions
                  </p>
                  <p className="mt-1">
                    {visit.clinical.conditions.join(', ') || (
                      <span className="text-[var(--ar-text-faint)]">none reported</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[0.72rem] uppercase tracking-wide text-[var(--ar-text-faint)]">
                    Current medications
                  </p>
                  <p className="mt-1">
                    {visit.clinical.medications.join(', ') || (
                      <span className="text-[var(--ar-text-faint)]">none reported</span>
                    )}
                  </p>
                </div>
              </div>
            </Card>
          ) : null}

          {visit.redactedSections.length > 0 ? (
            <Card>
              <CardHeader title="Not shown to you" />
              <p className="text-[0.82rem] text-[var(--ar-text-muted)]">
                {visit.redactedSections
                  .map((section) => section.replace(/_/g, ' ').toLowerCase())
                  .join(' and ')}{' '}
                {visit.redactedSections.length === 1 ? 'is' : 'are'} the clinician&rsquo;s own
                record. Withheld rather than empty — this patient may well have them.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
