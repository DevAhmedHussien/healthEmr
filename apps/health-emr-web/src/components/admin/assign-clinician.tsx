'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { UserIcon } from '@/components/ui/icons';

interface Candidate {
  id: string;
  name: string;
  email: string;
  open: number;
  capacity: number;
  atCapacity: boolean;
  acceptingNew: boolean;
  eligible: boolean;
  blocker: string | null;
}

/**
 * Handing a waiting visit to a named clinician.
 *
 * Only worth showing while a visit has nobody: the automatic sweep places
 * anything it can, so a visit still sitting here has a reason nobody could take
 * it, and that reason is what this dialog puts on screen. Everyone is listed,
 * including the ones who cannot be chosen — "why not" is the question being
 * asked, and hiding the refusals leaves an empty list that looks broken.
 */
export function AssignClinician({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [state, setState] = React.useState('');
  const [chosen, setChosen] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setOpen(true);
    setError(null);
    setCandidates(null);
    try {
      const result = await api<{ state: string; data: Candidate[] }>(
        `v1/super-admin/visits/${visitId}/candidates`,
      );
      setState(result.state);
      // Whoever can actually take it first; within that, the lightest load.
      setCandidates(
        [...result.data].sort(
          (a, b) => Number(b.eligible) - Number(a.eligible) || a.open - b.open,
        ),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load the clinician list.');
    }
  }

  async function assign() {
    setBusy(true);
    setError(null);
    try {
      await api(`v1/super-admin/visits/${visitId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ providerId: chosen, reason: reason.trim() }),
      });
      setOpen(false);
      setChosen('');
      setReason('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  // Ten characters, the floor the endpoint enforces.
  const ready = chosen && reason.trim().length >= 10;

  return (
    <>
      <Button size="sm" variant="outline" icon={UserIcon} onClick={load}>
        Assign a clinician
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Assign a clinician"
        description={`Nobody was placed automatically. Everyone licensed to practise in ${state || 'the patient’s state'} is below, with the reason for anyone who cannot take it.`}
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={assign} disabled={busy || !ready}>
              {busy ? 'Assigning…' : 'Assign this visit'}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        {!candidates ? (
          <p className="text-[0.9rem] text-[var(--ar-text-muted)]">Loading clinicians…</p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Clinician"
            className="max-h-72 space-y-1.5 overflow-y-auto"
          >
            {candidates.map((candidate) => (
              <label
                key={candidate.id}
                className={[
                  'flex items-center gap-3 rounded-[var(--ar-radius)] border p-2.5 text-[0.88rem]',
                  candidate.eligible
                    ? 'cursor-pointer border-[var(--ar-border)] hover:bg-[var(--ar-body-bg)]'
                    : 'cursor-not-allowed border-[var(--ar-border-soft)] opacity-60',
                  chosen === candidate.id ? 'bg-[var(--ar-primary-soft)]' : '',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="clinician"
                  value={candidate.id}
                  disabled={!candidate.eligible}
                  checked={chosen === candidate.id}
                  onChange={() => setChosen(candidate.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{candidate.name}</span>
                  <span className="block truncate text-[0.8rem] text-[var(--ar-text-muted)]">
                    {candidate.blocker ?? candidate.email}
                  </span>
                </span>
                {/* Over capacity is a warning, not a refusal — assigning anyway
                    is the decision this dialog exists to let somebody make. */}
                {candidate.eligible && candidate.atCapacity ? (
                  <Badge tone="warning">over capacity</Badge>
                ) : null}
                <span className="shrink-0 tabular-nums text-[0.8rem] text-[var(--ar-text-faint)]">
                  {candidate.open}/{candidate.capacity}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Field
            label="Why"
            hint="Required. Recorded against the visit and in the audit log, because this overrides an automatic routing decision."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. nobody was licensed in FL for this treatment"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
