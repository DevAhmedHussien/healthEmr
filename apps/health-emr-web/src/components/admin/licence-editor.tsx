'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { US_STATES } from '@health-emr/types';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { PlusIcon, SaveIcon } from '@/components/ui/icons';

export interface EditableLicence {
  id: string;
  state: string;
  licenseNumber: string;
  status: string;
  expiresAt: string;
}

/**
 * Adding a state to a clinician.
 *
 * Deliberately not the chip grid a pharmacy gets. A pharmacy's states are a
 * list of places it will post to; a clinician's are licences, and routing
 * refuses one without a number and a date in the future. Asking for all three
 * together is the only way the state becomes usable — a picker alone would
 * produce rows that look right and never receive a visit.
 */
export function AddLicence({
  providerId,
  held,
  scope,
}: {
  providerId?: string;
  /** States already on file, so the list only offers ones that would be accepted. */
  held: string[];
  /**
   * `platform` adds a verified licence. `self` is a clinician adding their own,
   * which arrives pending and cannot route until the platform checks it.
   */
  scope: 'platform' | 'self';
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState('');
  const [licenseNumber, setNumber] = React.useState('');
  const [expiresAt, setExpires] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const available = US_STATES.filter((candidate) => !held.includes(candidate));
  const expiryInPast = Boolean(expiresAt) && new Date(expiresAt) <= new Date();
  const ready = state && licenseNumber.trim() && expiresAt && !expiryInPast;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(
        scope === 'self' ? 'v1/clinic/me/licences' : `v1/super-admin/providers/${providerId}/licences`,
        {
          method: 'POST',
          body: JSON.stringify({
            state,
            licenseNumber: licenseNumber.trim(),
            // The input gives a day; the API takes an instant.
            expiresAt: new Date(`${expiresAt}T00:00:00.000Z`).toISOString(),
          }),
        },
      );
      setOpen(false);
      setState('');
      setNumber('');
      setExpires('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" icon={PlusIcon} onClick={() => setOpen(true)}>
        Add a state
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a state licence"
        description={
          scope === 'self'
            ? 'We check this against the state board before it counts. Until then it is recorded but not used to route visits to you.'
            : 'Live as soon as it is saved — this clinician can be routed visits in that state.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button icon={SaveIcon} onClick={save} disabled={busy || !ready}>
              {busy ? 'Saving…' : 'Add licence'}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="State"
            hint={
              available.length < US_STATES.length
                ? 'States already on file are not listed — edit the existing licence instead.'
                : undefined
            }
          >
            <SimpleSelect
              aria-label="State"
              value={state}
              onValueChange={setState}
              placeholder="Choose a state"
              options={available.map((code) => ({ value: code, label: code }))}
            />
          </Field>

          <Field label="Licence number">
            <Input
              aria-label="Licence number"
              value={licenseNumber}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="e.g. AZ-12345"
            />
          </Field>

          <Field
            label="Expires"
            hint={expiryInPast ? 'That date has already passed.' : 'Routing stops on this date.'}
          >
            <Input
              aria-label="Expires"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpires(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/**
 * What the platform can do to a licence that already exists: accept one a
 * clinician entered, or remove one entered in error.
 */
export function LicenceRowActions({
  providerId,
  licence,
}: {
  providerId: string;
  licence: EditableLicence;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function send(method: 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    try {
      await api(`v1/super-admin/providers/${providerId}/licences/${licence.id}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1.5">
      {licence.status === 'PENDING' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => send('PATCH', { status: 'ACTIVE', reason: 'Licence verified' })}
        >
          Verify
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => send('DELETE')}>
        Remove
      </Button>
    </div>
  );
}
