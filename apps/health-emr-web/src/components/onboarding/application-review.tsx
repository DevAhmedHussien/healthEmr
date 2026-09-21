'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Textarea,
  statusTone,
} from '@/components/ui/primitives';
import { DocumentViewer, type ViewableDocument } from './document-viewer';
import { LicencePanel, type ApplicationLicence } from './licence-panel';
import { UploadForApplicant } from './upload-for-applicant';
import { api, ApiError } from '@/lib/api';

export interface ApplicationDetail {
  id: string;
  status: string;
  source: string;
  reviewNotes: string | null;
  requiredDocuments: string[];
  documents: ViewableDocument[];
  licenses?: ApplicationLicence[];
  /**
   * Unverified licences, and whether a certificate is already waiting for each.
   *
   * Separate from `requiredDocuments`, which counts document *kinds* — one
   * accepted licence satisfies that however many states were claimed, while
   * approval needs one per state. Reading only the kinds is what produced
   * "0 still required" next to a blocked approval.
   */
  outstanding?: Array<{ licenceId: string; state: string; hasDocument: boolean }>;
  [key: string]: unknown;
}

const pretty = (value: string) => value.replace(/_/g, ' ').toLowerCase();

/**
 * The review screen.
 *
 * Shows what is *missing* as prominently as what was supplied — a reviewer's job
 * is to notice the absent licence, and a list that only renders uploads makes
 * that the hardest thing to see.
 */
export function ApplicationReview({
  scope,
  detail,
  fields,
  title,
  subtitle,
}: {
  scope: 'provider' | 'pharmacy';
  detail: ApplicationDetail;
  fields: Array<{ label: string; value: React.ReactNode }>;
  title: string;
  subtitle: string;
}) {
  const router = useRouter();
  const [decision, setDecision] = React.useState<'APPROVED' | 'REJECTED' | 'INFO_REQUESTED' | null>(
    null,
  );
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const accepted = new Set(
    detail.documents.filter((doc) => doc.reviewStatus === 'ACCEPTED').map((doc) => doc.kind),
  );
  const missingKinds = detail.requiredDocuments.filter((kind) => !accepted.has(kind));
  const unverified = (detail.licenses ?? []).filter((licence) => !licence.verifiedAt);
  const decided = ['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(detail.status);
  const blocked = missingKinds.length > 0 || unverified.length > 0;

  // Everything standing in the way, in one list, so the count beside "Documents"
  // is the same number as the reasons approval is refused.
  const todo = [
    ...missingKinds.map((kind) => ({ key: kind, text: `${pretty(kind)} — not yet accepted` })),
    ...(detail.outstanding ?? []).map((row) => ({
      key: `licence-${row.licenceId}`,
      text: row.hasDocument
        ? `${row.state} licence — a certificate is waiting, accept it below`
        : `${row.state} licence — no certificate, and not verified by hand`,
    })),
  ];

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      setDecision(null);
      setNotes('');
    } catch (caught) {
      setError(
        caught instanceof ApiError && Array.isArray(caught.details)
          ? (caught.details as Array<{ message: string }>).map((d) => d.message).join(' · ')
          : (caught as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/applications" className="text-[0.8rem] font-medium">
            ← Applications
          </Link>
          <h2 className="mt-1">{title}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(detail.status)}>{pretty(detail.status)}</Badge>
          {detail.source === 'SUPER_ADMIN' ? <Badge tone="neutral">entered by us</Badge> : null}
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Application" />
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.label}>
                  <dt className="text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--ar-text-faint)]">
                    {field.label}
                  </dt>
                  <dd className="mt-0.5 text-[0.9rem]">{field.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {detail.licenses ? (
            <LicencePanel applicationId={detail.id} licences={detail.licenses} readOnly={decided} />
          ) : null}

          <Card>
            <CardHeader
              title="Documents"
              subtitle={`${detail.documents.length} uploaded · ${todo.length} still outstanding`}
              action={
                decided ? undefined : <UploadForApplicant scope={scope} applicationId={detail.id} />
              }
            />

            {todo.length > 0 ? (
              <div className="mb-4">
                <Alert tone="warning">
                  <p className="font-medium">Still needed before this can be approved</p>
                  <ul className="mt-1 list-disc pl-4 text-[0.85rem]">
                    {todo.map((item) => (
                      <li key={item.key}>{item.text}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            ) : null}

            <DocumentViewer
              scope={scope}
              documents={detail.documents}
              busy={busy}
              onReview={(documentId, verdict) =>
                run(() =>
                  api(`v1/super-admin/onboarding/${scope}/documents/${documentId}/review`, {
                    method: 'POST',
                    body: JSON.stringify({ decision: verdict }),
                  }),
                )
              }
            />
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Decision" />

          {decided ? (
            <div className="space-y-2">
              <Alert tone={detail.status === 'APPROVED' ? 'success' : 'danger'}>
                Already {detail.status.toLowerCase()}.
              </Alert>
              {detail.reviewNotes ? (
                <p className="text-[0.85rem] text-[var(--ar-text-muted)]">{detail.reviewNotes}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {blocked ? (
                <Alert tone="warning">
                  Approval is blocked until
                  {missingKinds.length > 0 ? ' every required document is accepted' : ''}
                  {missingKinds.length > 0 && unverified.length > 0 ? ' and' : ''}
                  {unverified.length > 0
                    ? ` the ${unverified.map((l) => l.state).join(', ')} licence${unverified.length > 1 ? 's are' : ' is'} verified`
                    : ''}
                  .{' '}
                  {/* Naming the fix, not just the fault — the panel above is
                       where both are cleared, and a reviewer who cannot find it
                       raises a ticket instead. */}
                  <span className="mt-1 block text-[0.82rem]">
                    Accept the certificate below, upload one for them, or verify the licence by
                    hand.
                  </span>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2">
                {(
                  [
                    ['APPROVED', 'Approve', 'primary'],
                    ['INFO_REQUESTED', 'Request more info', 'outline'],
                    ['REJECTED', 'Reject', 'danger'],
                  ] as const
                ).map(([value, label, variant]) => (
                  <Button
                    key={value}
                    variant={decision === value ? 'primary' : variant}
                    onClick={() => setDecision(value)}
                    disabled={busy || (value === 'APPROVED' && blocked)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {decision ? (
                <>
                  <Field
                    label={decision === 'APPROVED' ? 'Note (optional)' : 'Tell the applicant why'}
                    hint={decision === 'APPROVED' ? undefined : 'Required — they will receive this'}
                  >
                    <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </Field>
                  <Button
                    className="w-full"
                    disabled={busy || (decision !== 'APPROVED' && notes.trim().length < 3)}
                    onClick={() =>
                      run(() =>
                        api(
                          `v1/super-admin/onboarding/${scope === 'provider' ? 'providers' : 'pharmacies'}/${detail.id}/decision`,
                          {
                            method: 'POST',
                            body: JSON.stringify({ decision, notes: notes || undefined }),
                          },
                        ),
                      )
                    }
                  >
                    {busy ? 'Saving…' : `Confirm ${pretty(decision)}`}
                  </Button>
                </>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
