'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { US_STATES } from '@health-emr/types';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { UploadIcon } from '@/components/ui/icons';
import { ApiError } from '@/lib/api';

const PROVIDER_KINDS = [
  { value: 'STATE_MEDICAL_LICENSE', label: 'State medical licence' },
  { value: 'DEA_REGISTRATION', label: 'DEA registration' },
  { value: 'MALPRACTICE_INSURANCE', label: 'Malpractice insurance' },
  { value: 'GOVERNMENT_ID', label: 'Government ID' },
  { value: 'CURRICULUM_VITAE', label: 'Curriculum vitae' },
  { value: 'BOARD_CERTIFICATION', label: 'Board certification' },
];

const PHARMACY_KINDS = [
  { value: 'STATE_PHARMACY_LICENSE', label: 'State pharmacy licence' },
  { value: 'DEA_REGISTRATION', label: 'DEA registration' },
  { value: 'ACCREDITATION', label: 'Accreditation' },
  { value: 'INSURANCE_CERTIFICATE', label: 'Insurance certificate' },
  { value: 'FACILITY_LICENSE', label: 'Facility licence' },
];

/**
 * Upload a document on an applicant's behalf.
 *
 * Certificates arrive by email and by fax, and an application that cannot
 * progress because the form is closed is a support ticket rather than a
 * decision. The upload is recorded against the Super Admin who made it, so a
 * reviewer can see it did not come from the applicant.
 *
 * Posted directly rather than through the shared `api()` helper: this is
 * multipart, and that helper sets a JSON content type — which strips the
 * boundary and breaks the parser at the other end.
 */
export function UploadForApplicant({
  scope,
  applicationId,
}: {
  scope: 'provider' | 'pharmacy';
  applicationId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState(
    scope === 'provider' ? 'STATE_MEDICAL_LICENSE' : 'STATE_PHARMACY_LICENSE',
  );
  const [state, setState] = React.useState('');
  const [note, setNote] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const kinds = scope === 'provider' ? PROVIDER_KINDS : PHARMACY_KINDS;
  // A licence proves nothing until it is tied to the state it was issued in:
  // accepting one without a state verifies no licence at all.
  const needsState = kind.includes('LICENSE');

  function reset() {
    setOpen(false);
    setFile(null);
    setNote('');
    setState('');
    setError(null);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      const body = new FormData();
      body.append('file', file);
      body.append('kind', kind);
      if (needsState && state) body.append('state', state);
      if (note.trim()) body.append('uploadedNote', note.trim());

      const response = await fetch(
        `/api/bff/v1/super-admin/onboarding/${scope}/${applicationId}/documents`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new ApiError(detail?.message ?? 'That upload did not work', response.status);
      }

      reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That upload did not work');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" icon={UploadIcon} onClick={() => setOpen(true)}>
        Upload for them
      </Button>

      <Modal
        open={open}
        onClose={reset}
        title="Upload a document for this applicant"
        description={[
          'For a certificate that arrived by email or fax rather than through the form.',
          'It is recorded against you, so whoever reviews it can see where it came from.',
        ]}
        footer={
          <>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button
              icon={UploadIcon}
              disabled={busy || !file || (needsState && !state)}
              onClick={submit}
            >
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <div className="grid gap-4">
          <Field label="What is it?">
            <SimpleSelect value={kind} onValueChange={setKind} options={kinds} />
          </Field>

          {needsState ? (
            <Field
              label="Which state?"
              hint="A licence verifies that state and no other, so this is not optional."
            >
              <SimpleSelect
                value={state}
                onValueChange={setState}
                placeholder="Select a state"
                options={US_STATES.map((code) => ({ value: code, label: code }))}
              />
            </Field>
          ) : null}

          <Field label="File" hint="PDF or an image, up to 10MB.">
            <Input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.heic,.webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>

          <Field
            label="Where did it come from?"
            hint="Optional, but it saves the next person asking."
          >
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Emailed by the applicant, 19 Sep"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
