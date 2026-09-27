import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverApi, swallow } from '@/lib/server-api';
import { Alert, Badge, Card, CardHeader, statusTone } from '@/components/ui/primitives';
import { VisitPhotos, type VisitPhoto } from '@/components/portal/visit-photos';
import { formatDateTime, formatDob, formatPhone } from '@/lib/format';
import { ReviewForm } from './review-form';
import { AskPatient } from './ask-patient';

export const metadata = { title: 'Review a visit — HealthEMR' };

interface Visit {
  id: string;
  masterId: string;
  status: string;
  tenant: string;
  category: { slug: string; name: string };
  submittedAt: string;
  patientState: string;
  patient: {
    id: string;
    mrn: string;
    name: string;
    dob: string;
    sexAtBirth: string;
    phone: string;
    email: string;
    shipTo: string;
  };
  clinical: {
    allergies: { substance: string; severity: string; reaction: string | null }[];
    conditions: string[];
    medications: string[];
  };
  questionnaire: {
    version: number;
    answers: { questionId: string; question: string; answer: string }[];
  };
  photos: VisitPhoto[];
  requested: {
    id: string;
    name: string;
    strength: string | null;
    quantity: string | null;
    refills: number | null;
    daysSupply: number | null;
    kitCode: string | null;
    decision: string;
    decisionReason: string | null;
    /** False for a line a colleague is reviewing on a shared visit. */
    mine: boolean;
  }[];
  /** True when this visit's medications are split across two clinicians. */
  shared: boolean;
}

/**
 * Splits a question of the form
 *   "Have you taken X? POSSIBLE ANSWERS: a; b; c"
 * into the question and the options the patient chose between, which is how the
 * partner contract encodes multiple choice. The options matter clinically: "No"
 * means something different when the alternatives were "No / Not in six months /
 * Never".
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

export default async function ReviewVisit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The whole chart, from the endpoint that exists for exactly this. This page
  // used to read the queue list instead, which meant a clinician decided from
  // the medication lines alone — without the questionnaire, the allergies, or
  // the identity document.
  const visit = await serverApi<Visit>(`v1/clinic/visits/${id}`).catch(swallow(null));
  if (!visit) notFound();

  const decided = visit.status === 'APPROVED' || visit.status === 'DENIED';

  // A visit whose medications span categories no single clinician covers is
  // shared out, and then "decided" is a question about this clinician's own
  // lines rather than about the visit. The rest of the chart stays visible:
  // deciding one medication safely means seeing the other.
  const mineOutstanding = visit.requested.filter((item) => item.mine && item.decision === 'PENDING');
  const theirLines = visit.requested.filter((item) => !item.mine);
  const identity = visit.photos.find((photo) => photo.kind === 'ID_PHOTO');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/clinic" className="text-[0.8rem] font-medium">
            ← My queue
          </Link>
          <h2 className="mt-1">{visit.patient.name}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            {visit.category.name} · {visit.patient.mrn} · sent by {visit.tenant} · submitted{' '}
            {formatDateTime(visit.submittedAt)}
          </p>
        </div>
        <Badge tone={statusTone(visit.status)}>
          {visit.status.replace(/_/g, ' ').toLowerCase()}
        </Badge>
      </div>

      {!identity ? (
        <Alert tone="warning">
          <strong>No identity document on this visit.</strong> The patient did not upload one, so
          there is nothing here to verify them against before you prescribe.
        </Alert>
      ) : null}

      {visit.clinical.allergies.length > 0 ? (
        <Alert tone="danger">
          <strong>Allergies on file:</strong>{' '}
          {visit.clinical.allergies
            .map((allergy) =>
              [allergy.substance, allergy.severity.toLowerCase(), allergy.reaction]
                .filter(Boolean)
                .join(' · '),
            )
            .join(' — ')}
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Intake questionnaire"
              subtitle={`${visit.category.name} · version ${visit.questionnaire.version} · the patient's own answers`}
            />
            <dl className="space-y-3">
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
                        <span className="text-[var(--ar-text-faint)]">no answer given</span>
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

          <VisitPhotos
            endpoint={`/api/bff/v1/clinic/visits/${visit.id}/photos/{id}`}
            photos={visit.photos}
            title="Identity and uploads"
            subtitle="Verify the person before you prescribe. Each view is recorded against the chart."
            preview
          />

          <Card>
            <CardHeader
              action={mineOutstanding.length > 0 ? <AskPatient visitId={visit.id} /> : undefined}
              title={visit.shared ? 'Decide your lines' : 'Decide every line'}
              subtitle={
                visit.shared
                  ? `Another clinician is reviewing ${theirLines.length === 1 ? 'the other medication' : 'the other medications'} on this visit. Decide yours; the visit closes when both of you have.`
                  : 'Approve as requested, modify with a reason, or deny. Nothing may be left undecided.'
              }
            />
            {decided ? (
              <Alert tone="info">
                This visit has already been decided. It is shown here as a record.
              </Alert>
            ) : mineOutstanding.length === 0 ? (
              <Alert tone="info">
                You have decided everything on this visit that is yours to decide. It stays open
                until your colleague has decided theirs.
              </Alert>
            ) : (
              <ReviewForm
                visitId={visit.id}
                items={mineOutstanding.map((item) => ({
                  id: item.id,
                  nameText: item.name,
                  strength: item.strength ?? '',
                  quantity: item.quantity ?? '',
                  daysSupply: item.daysSupply,
                }))}
              />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Patient" />
            <dl className="space-y-3">
              <Detail label="Date of birth" value={formatDob(visit.patient.dob)} />
              <Detail label="Sex at birth" value={visit.patient.sexAtBirth.toLowerCase()} />
              <Detail label="Phone" value={formatPhone(visit.patient.phone)} />
              <Detail label="Email" value={visit.patient.email} />
              <Detail label="Ship to" value={visit.patient.shipTo} />
              <Detail
                label="State at submission"
                value={
                  <>
                    <span className="font-medium">{visit.patientState}</span>
                    <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                      You are on this queue because you hold a current licence here.
                    </span>
                  </>
                }
              />
            </dl>
          </Card>

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
                        <span className="font-medium">{allergy.substance}</span>
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

          <Card>
            <CardHeader title="Requested" />
            <ul className="space-y-2 text-[0.85rem]">
              {visit.requested.map((item) => (
                <li
                  key={item.id}
                  className="border-b border-[var(--ar-border)] pb-2 last:border-0 last:pb-0"
                >
                  <span className="font-medium text-[var(--ar-headings)]">{item.name}</span>
                  {item.mine ? null : (
                    <span className="ml-2 align-middle text-[0.7rem] text-[var(--ar-text-muted)]">
                      · with another clinician
                    </span>
                  )}
                  <span className="block text-[0.75rem] text-[var(--ar-text-muted)]">
                    {[
                      item.strength,
                      item.quantity ? `qty ${item.quantity}` : null,
                      item.refills !== null ? `${item.refills} refills` : null,
                      item.daysSupply ? `${item.daysSupply} days` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
