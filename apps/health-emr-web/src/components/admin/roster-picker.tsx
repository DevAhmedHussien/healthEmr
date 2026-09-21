'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { MortarIcon, PlusIcon, StethoscopeIcon } from '@/components/ui/icons';
import { SimpleSelect } from '@/components/ui/select';

interface Option {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Attaches a pharmacy or a clinician to a client business.
 *
 * The list is fetched when the control is opened rather than with the page: a
 * profile should not pay for the directory on every load to populate a select
 * most visits never touch. Options already on the roster are filtered out, so
 * the only thing offered is something that would actually change state.
 */
export function RosterPicker({
  tenantId,
  kind,
  exclude,
}: {
  tenantId: string;
  kind: 'pharmacy' | 'provider';
  /** Ids already on the roster. */
  exclude: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || options) return;
    const endpoint =
      kind === 'pharmacy'
        ? 'v1/super-admin/pharmacies/directory?pageSize=100'
        : 'v1/super-admin/providers?pageSize=100';

    api<{ data: Array<Record<string, unknown>> }>(endpoint)
      .then((response) => {
        const excluded = new Set(exclude);
        setOptions(
          response.data
            .map((row) => ({
              id: String(row.id),
              label: String(row.name ?? ''),
              hint:
                kind === 'pharmacy'
                  ? [row.status, (row.statesServed as string[] | undefined)?.join(', ')]
                      .filter(Boolean)
                      .join(' · ')
                  : [row.credentials, (row.licensedStates as string[] | undefined)?.join(', ')]
                      .filter(Boolean)
                      .join(' · '),
            }))
            .filter((option) => option.id && !excluded.has(option.id)),
        );
      })
      .catch(() => setError('Could not load the directory.'));
  }, [open, options, kind, exclude]);

  async function attach() {
    setBusy(true);
    setError(null);
    try {
      await api(`v1/super-admin/admins/${tenantId}/roster`, {
        method: 'POST',
        body: JSON.stringify({
          [kind === 'pharmacy' ? 'pharmacyId' : 'providerId']: choice,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      setOpen(false);
      setChoice('');
      setReason('');
      setOptions(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const Icon = kind === 'pharmacy' ? MortarIcon : StethoscopeIcon;
  const noun = kind === 'pharmacy' ? 'pharmacy' : 'clinician';

  return (
    <>
      <Button variant="outline" size="sm" icon={PlusIcon} onClick={() => setOpen(true)}>
        Add {noun}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Add a ${noun} to this client`}
        description={
          kind === 'pharmacy'
            ? 'Only pharmacies not already on the roster are offered. An archived pharmacy cannot be added until it is restored.'
            : 'Only clinicians not currently contracted are offered. They are routed work for this client once their licence covers the patient’s state.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button icon={Icon} onClick={attach} disabled={busy || !choice}>
              {busy ? 'Adding…' : 'Add to roster'}
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
          <Field label={kind === 'pharmacy' ? 'Pharmacy' : 'Clinician'}>
            <SimpleSelect
              value={choice}
              onValueChange={setChoice}
              disabled={options !== null && options.length === 0}
              placeholder={
                options === null
                  ? 'Loading…'
                  : options.length
                    ? 'Choose one'
                    : 'Everyone is already on this roster'
              }
              options={(options ?? []).map((option) => ({
                value: option.id,
                label: option.label,
                hint: option.hint,
              }))}
            />
          </Field>

          <Field label="Reason (optional)" hint="Recorded with the change.">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are they being added?"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
