import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverApi, swallow } from '@/lib/server-api';
import { Alert, Badge, Card, CardHeader, TableWrap, statusTone } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { ActionDialog } from '@/components/admin/action-dialog';
import { EditPanel } from '@/components/admin/edit-panel';

interface Questionnaire {
  visitId: string;
  masterId: string;
  status: string;
  voidedAt: string | null;
  voidedReason: string | null;
  category: string;
  tenant: string;
  patient: {
    id: string;
    mrn: string;
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  provider: string | null;
  submittedAt: string;
  patientStateAtSubmission: string;
  decidedAt: string | null;
  clinical: Array<{ label: string; value: string }>;
  answers: Array<{
    questionId: string;
    question: string;
    answer: string;
    answeredAt: string;
  }>;
  requested: Array<{
    id: string;
    name: string;
    strength: string;
    quantity: string;
    refills: string;
    decision: string;
    reason: string | null;
    approvedStrength: string | null;
    approvedQuantity: string | null;
  }>;
  prescriptions: Array<{ id: string; status: string }>;
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

export default async function QuestionnairePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const qa = await serverApi<Questionnaire>(`v1/super-admin/visits/${id}/questionnaire`).catch(swallow(null));
  if (!qa) notFound();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/prescriptions" className="text-[0.8rem] font-medium">
            ← Prescriptions
          </Link>
          <h2 className="mt-1">Visit {qa.masterId}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {qa.category} · {qa.tenant} · submitted {formatDateTime(qa.submittedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={qa.voidedAt ? 'neutral' : statusTone(qa.status)}>
            {qa.voidedAt ? 'withdrawn' : qa.status.replace(/_/g, ' ').toLowerCase()}
          </Badge>
          {qa.voidedAt ? (
            <ActionDialog
              label="Put it back"
              icon="restore"
              requireReason={false}
              path={`v1/super-admin/visits/${qa.visitId}/restore`}
              successMessage="The visit counts again from now on."
              description={[
                'The visit reappears in the client\u2019s lists and starts counting toward revenue and profit again.',
                'The provider fee and any cancelled pharmacy order are not reinstated \u2014 those are decisions for a person, not consequences of undoing a click.',
              ]}
            />
          ) : (
            <>
              {/* Pre-filled from the record. Editing a field whose current
                  value is not on screen is how a good address gets overwritten
                  with a blank one. */}
              <EditPanel
                title="Correct this visit"
                label="Correct"
                // The endpoint requires it, so the form has to as well —
                // otherwise the only feedback is a 400 after you press save.
                reason="required"
                path={`v1/super-admin/visits/${qa.visitId}`}
                fields={[
                  { name: 'address', label: 'Address', value: qa.patient.address },
                  { name: 'city', label: 'City', value: qa.patient.city },
                  { name: 'zip', label: 'ZIP', value: qa.patient.zip, type: 'zip' },
                  { name: 'phone', label: 'Phone', value: qa.patient.phone, type: 'phone' },
                  { name: 'email', label: 'Email', value: qa.patient.email },
                ]}
              />

              <ActionDialog
                label="Withdraw"
                variant="danger"
                icon="trash"
                method="DELETE"
                path={`v1/super-admin/visits/${qa.visitId}`}
                confirmLabel="Withdraw this visit"
                successMessage="Withdrawn. It no longer counts for anyone."
                description={[
                  'For when the client business asks for a visit to be removed \u2014 a test submission, a duplicate, an order the patient disputed.',
                  'It disappears from every list and stops counting toward revenue, cost and profit. Any provider fee is voided and any order still queued is cancelled.',
                  'The record itself is kept, because a clinician may have read this chart. Say why: it goes in the audit log.',
                ]}
              />

              {/* A separate control, not a checkbox on the one above. The guard
                  exists because the medication is in the post to a real
                  address; overriding it should take a second decision, not a
                  tick nobody reads. */}
              <ActionDialog
                label="Withdraw anyway"
                variant="danger"
                icon="trash"
                method="DELETE"
                path={`v1/super-admin/visits/${qa.visitId}`}
                body={{ force: true }}
                confirmLabel="Withdraw a shipped visit"
                successMessage="Withdrawn, over the shipped-medication guard."
                description={[
                  'Use this only when the visit has already shipped and has to be withdrawn regardless \u2014 a duplicate, or a test order that went out by mistake.',
                  'A medication reached a real patient at a real address, and the record will no longer say so. The audit entry will record that it had shipped when you did this.',
                ]}
              />
            </>
          )}
        </div>
      </div>

      {qa.voidedAt ? (
        <Alert tone="warning">
          Withdrawn {formatDateTime(qa.voidedAt)}
          {qa.voidedReason ? ` \u2014 ${qa.voidedReason}` : ''}. Nobody but the platform owner can
          see this visit, and it counts toward nothing.
        </Alert>
      ) : null}

      <Alert tone="warning">
        This is the patient&rsquo;s own account of their health. Opening it has been recorded in the
        audit log as break-the-glass access.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="What the patient reported"
              subtitle="The structured clinical fields from the intake form."
            />
            <dl className="space-y-3">
              {qa.clinical.map((field) => (
                <div key={field.label}>
                  <dt className="text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ar-text-faint)]">
                    {field.label}
                  </dt>
                  <dd className="mt-0.5 text-[0.9rem]">{field.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Questionnaire"
              subtitle={`${qa.answers.length} question${qa.answers.length === 1 ? '' : 's'} answered`}
            />
            {qa.answers.length === 0 ? (
              <p className="text-[0.9rem] text-[var(--ar-text-muted)]">
                No free-form questions were submitted with this visit.
              </p>
            ) : (
              <ol className="space-y-4">
                {qa.answers.map((answer) => {
                  const { question, options } = splitQuestion(answer.question);
                  const chosen = answer.answer.split(';').map((value) => value.trim());

                  return (
                    <li
                      key={answer.questionId}
                      className="border-b border-[var(--ar-border-soft)] pb-4 last:border-0 last:pb-0"
                    >
                      <p className="text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ar-text-faint)]">
                        {answer.questionId}
                      </p>
                      <p className="mt-0.5 text-[0.92rem] font-medium">{question}</p>

                      {options.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {options.map((option) => {
                            const picked = chosen.includes(option);
                            return (
                              <span
                                key={option}
                                className={
                                  picked
                                    ? 'rounded-[var(--ar-radius)] bg-[var(--ar-primary)] px-2 py-1 text-[0.78rem] text-white'
                                    : 'rounded-[var(--ar-radius)] bg-[var(--ar-gray-50)] px-2 py-1 text-[0.78rem] text-[var(--ar-text-faint)]'
                                }
                              >
                                {option}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-1.5 rounded-[var(--ar-radius)] bg-[var(--ar-gray-50)] px-3 py-2 text-[0.9rem]">
                          {answer.answer || (
                            <span className="text-[var(--ar-text-faint)]">no answer</span>
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader
              title="What was requested, and what the provider decided"
              subtitle="A MODIFIED line shows both what the patient asked for and what was signed."
            />
            <TableWrap>
              <thead>
                <tr>
                  <th>Medication</th>
                  <th>Requested</th>
                  <th>Approved as</th>
                  <th>Decision</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {qa.requested.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.name}</td>
                    <td>
                      {item.strength} · qty {item.quantity} · {item.refills} refills
                    </td>
                    <td>
                      {item.approvedStrength || item.approvedQuantity ? (
                        <span>
                          {item.approvedStrength ?? item.strength}
                          {item.approvedQuantity ? ` · qty ${item.approvedQuantity}` : ''}
                        </span>
                      ) : (
                        <span className="text-[var(--ar-text-faint)]">as requested</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={statusTone(item.decision)}>{item.decision.toLowerCase()}</Badge>
                    </td>
                    <td className="text-[0.82rem]">{item.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Visit" />
            <dl className="space-y-2.5 text-[0.875rem]">
              {[
                ['Patient', qa.patient.name],
                ['Record', qa.patient.mrn],
                ['Reviewed by', qa.provider ?? 'unassigned'],
                ['State at submission', qa.patientStateAtSubmission],
                ['Decided', qa.decidedAt ? formatDateTime(qa.decidedAt) : 'not yet'],
                ['Prescriptions', String(qa.prescriptions.length)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-[var(--ar-text-muted)]">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t border-[var(--ar-border-soft)] pt-3">
              <Link
                href={`/super-admin/patients/${qa.patient.id}`}
                className="text-[0.85rem] font-medium"
              >
                Open full patient record →
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Why this matters"
              subtitle="The state recorded here is the one routing used."
            />
            <p className="text-[0.85rem] text-[var(--ar-text-muted)]">
              Licensure follows where the patient physically was when they submitted, not their
              mailing address. This visit was only ever offered to a clinician holding a current{' '}
              {qa.patientStateAtSubmission} licence.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
