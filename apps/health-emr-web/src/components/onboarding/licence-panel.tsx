'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Textarea,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { CheckIcon, ShieldIcon } from '@/components/ui/icons';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateShort } from '@/lib/format';

export interface ApplicationLicence {
  id: string;
  state: string;
  licenseNumber: string;
  expiresAt: string;
  verifiedAt: string | null;
  verifiedMethod: 'DOCUMENT' | 'MANUAL' | null;
  verifiedNote: string | null;
}

const MIN_NOTE = 10;

/**
 * The state licences on an application, and how each came to be trusted.
 *
 * Routing treats a verified licence as proof a clinician may prescribe into a
 * state, so this panel has two jobs: let a reviewer clear the block, and leave
 * behind enough of a record that somebody can answer "on what basis" two years
 * later. The note is required for that second reason, not the first.
 *
 * Normally a licence is verified by accepting a certificate for that state. This
 * covers the cases where there is no certificate to accept — the board is
 * checkable online, or the document arrived by fax — which previously left an
 * application permanently unapprovable with nothing on screen explaining why.
 */
export function LicencePanel({
  applicationId,
  licences,
  readOnly = false,
}: {
  applicationId: string;
  licences: ApplicationLicence[];
  /** A decided application is a record, not a workspace. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<{
    licence: ApplicationLicence;
    mode: 'verify' | 'withdraw';
  } | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const open = (licence: ApplicationLicence, mode: 'verify' | 'withdraw') => {
    setEditing({ licence, mode });
    setNote('');
    setError(null);
  };

  async function submit() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const path = editing.mode === 'verify' ? 'verify' : 'unverify';
      await api(
        `v1/super-admin/onboarding/providers/${applicationId}/licences/${editing.licence.id}/${path}`,
        {
          method: 'POST',
          body: JSON.stringify(
            editing.mode === 'verify' ? { note: note.trim() } : { reason: note.trim() },
          ),
        },
      );
      setEditing(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const expired = (licence: ApplicationLicence) => new Date(licence.expiresAt) <= new Date();

  return (
    <Card>
      <CardHeader
        title="State licences"
        subtitle="Routing trusts these absolutely. Each needs either an accepted certificate or a note saying what you checked."
      />

      <div className="space-y-2">
        {licences.map((licence) => (
          <div
            key={licence.id}
            className="rounded-[var(--ar-radius)] bg-[var(--ar-gray-50)] px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {licence.state} · {licence.licenseNumber}
              </span>

              <span className="flex items-center gap-2 text-[0.8rem]">
                <span
                  className={
                    expired(licence)
                      ? 'font-medium text-[var(--ar-danger)]'
                      : 'text-[var(--ar-text-muted)]'
                  }
                >
                  {expired(licence) ? 'expired' : 'expires'} {formatDateShort(licence.expiresAt)}
                </span>
                <Badge tone={licence.verifiedAt ? 'success' : 'warning'}>
                  {licence.verifiedAt ? 'verified' : 'unverified'}
                </Badge>

                {readOnly ? null : licence.verifiedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => open(licence, 'withdraw')}>
                    Withdraw
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={CheckIcon}
                    disabled={expired(licence)}
                    onClick={() => open(licence, 'verify')}
                  >
                    Verify by hand
                  </Button>
                )}
              </span>
            </div>

            {/* How it was trusted, not just that it was. A licence verified from
                a certificate and one verified from somebody's word are different
                facts, and the difference matters to whoever audits this. */}
            {licence.verifiedAt ? (
              <p className="mt-1 text-[0.75rem] text-[var(--ar-text-faint)]">
                {licence.verifiedMethod === 'MANUAL'
                  ? `Verified by hand on ${formatDate(licence.verifiedAt)}`
                  : `Verified from an accepted certificate on ${formatDate(licence.verifiedAt)}`}
                {licence.verifiedNote ? ` — ${licence.verifiedNote}` : ''}
              </p>
            ) : expired(licence) ? (
              <p className="mt-1 text-[0.75rem] text-[var(--ar-danger)]">
                An expired licence cannot be verified. Ask for a current one.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        tone={editing?.mode === 'withdraw' ? 'danger' : 'default'}
        title={
          editing?.mode === 'withdraw'
            ? `Withdraw the ${editing.licence.state} verification`
            : `Verify ${editing?.licence.state} ${editing?.licence.licenseNumber}`
        }
        description={
          editing?.mode === 'withdraw'
            ? [
                'The licence goes back to unverified and approval is blocked again.',
                'Nothing already approved is affected.',
              ]
            : [
                'Use this when there is no certificate to accept — you checked the state board directly, or it arrived outside the system.',
                'Routing will treat this clinician as licensed to prescribe into this state.',
              ]
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={editing?.mode === 'withdraw' ? 'danger' : 'primary'}
              icon={editing?.mode === 'withdraw' ? undefined : ShieldIcon}
              disabled={busy || note.trim().length < MIN_NOTE}
              onClick={submit}
            >
              {busy ? 'Saving…' : editing?.mode === 'withdraw' ? 'Withdraw' : 'Mark verified'}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <Field
          label={
            editing?.mode === 'withdraw' ? 'Why are you withdrawing it?' : 'What did you check?'
          }
          hint={
            editing?.mode === 'withdraw'
              ? `At least ${MIN_NOTE} characters. Written to the audit log.`
              : `At least ${MIN_NOTE} characters. This is the whole audit trail — name the source and the date.`
          }
        >
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              editing?.mode === 'withdraw'
                ? 'Verified against the wrong state.'
                : 'Checked azmd.gov licence lookup on 19 Sep 2026 — active, expires Jan 2030.'
            }
          />
        </Field>
      </Modal>
    </Card>
  );
}
