'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { AlertTriangleIcon, MortarIcon } from '@/components/ui/icons';

interface Pharmacy {
  id: string;
  name: string;
  status: string;
  dispensesCompounded?: boolean;
  dispensesBranded?: boolean;
  statesServed?: string[];
}

export interface SelectedPrescription {
  id: string;
  medication: string;
  patient: { name: string };
  shipment: { pharmacy: string; status: string } | null;
}

interface Outcome {
  moved: Array<{
    prescriptionId: string;
    toPharmacy: string;
    transmitted: boolean;
    warning: string | null;
  }>;
  skipped: Array<{ prescriptionId: string; why: string }>;
}

/**
 * Moves a selection of prescriptions to a different pharmacy.
 *
 * Bulk because the reason to do this is rarely one prescription: a pharmacy goes
 * down, or stops carrying a product, and everything routed there is stuck at
 * once. Each is still attempted independently, and the result says what moved
 * and what did not — a batch that silently half-succeeds is worse than one that
 * fails, because nobody goes looking for the remainder.
 */
export function RerouteSelected({
  selected,
  clear,
}: {
  selected: SelectedPrescription[];
  clear: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pharmacies, setPharmacies] = React.useState<Pharmacy[] | null>(null);
  const [choice, setChoice] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [acceptSecondParcel, setAcceptSecondParcel] = React.useState(false);

  /**
   * The ones already in the post.
   *
   * Rerouting does not divert a parcel — it cancels one order and raises
   * another — so for these the patient receives a second box. Sometimes that is
   * exactly the intention, when the first was lost or never arrived, which is
   * why it is a confirmation rather than a refusal.
   */
  const alreadyShipped = React.useMemo(
    () => selected.filter((row) => ['SHIPPED', 'DELIVERED'].includes(row.shipment?.status ?? '')),
    [selected],
  );

  React.useEffect(() => {
    if (!open || pharmacies) return;
    api<{ data: Pharmacy[] }>('v1/super-admin/pharmacies/directory?pageSize=100')
      .then((response) => setPharmacies(response.data.filter((row) => row.status === 'ACTIVE')))
      .catch(() => setError('Could not load the pharmacies.'));
  }, [open, pharmacies]);

  // Where the selection currently sits, so it is obvious what is being moved
  // from where — a selection spanning three pharmacies is worth noticing.
  const from = React.useMemo(() => {
    const names = new Set(selected.map((row) => row.shipment?.pharmacy ?? 'not yet dispatched'));
    return [...names];
  }, [selected]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Outcome>('v1/super-admin/prescriptions/reroute', {
        method: 'POST',
        body: JSON.stringify({
          prescriptionIds: selected.map((row) => row.id),
          pharmacyId: choice,
          reason: reason.trim(),
          ...(alreadyShipped.length ? { force: true } : {}),
        }),
      });
      setOutcome(result);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setOutcome(null);
    setReason('');
    setAcceptSecondParcel(false);
    setChoice('');
    if (outcome?.moved.length) clear();
  }

  return (
    <>
      <Button size="sm" icon={MortarIcon} onClick={() => setOpen(true)}>
        Reroute {selected.length}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={
          outcome
            ? 'Result'
            : `Move ${selected.length} prescription${selected.length === 1 ? '' : 's'}`
        }
        description={
          outcome
            ? undefined
            : `Currently at ${from.join(', ')}. Each one is moved on its own, so anything that cannot be will be reported rather than stopping the rest.`
        }
        width="lg"
        footer={
          outcome ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                icon={MortarIcon}
                onClick={send}
                disabled={
                  busy ||
                  !choice ||
                  reason.trim().length < 10 ||
                  // A second parcel has to be acknowledged, not just clicked past.
                  (alreadyShipped.length > 0 && !acceptSecondParcel)
                }
              >
                {busy ? 'Moving…' : `Reroute ${selected.length}`}
              </Button>
            </>
          )
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        {alreadyShipped.length && !outcome ? (
          <div className="mb-4 rounded-[var(--ar-radius)] border border-[var(--ar-danger)] bg-[var(--ar-danger-soft)] p-4">
            <p className="font-medium text-[var(--ar-on-danger)]">
              {alreadyShipped.length} of these {alreadyShipped.length === 1 ? 'has' : 'have'}{' '}
              already shipped.
            </p>
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-[var(--ar-body-color)]">
              Rerouting does not turn a parcel around. It cancels the order at the old pharmacy and
              raises a new one, so the patient receives a{' '}
              <strong>second box of a prescription medication</strong> — and is billed for it. Do
              this when the first was lost or never arrived, not to correct a mistake on an order
              that has left the building.
            </p>

            <ul className="mt-2.5 space-y-1">
              {alreadyShipped.slice(0, 5).map((row) => (
                <li key={row.id} className="text-[0.82rem] text-[var(--ar-body-color)]">
                  {row.patient.name} · {row.medication} ·{' '}
                  <span className="text-[var(--ar-text-muted)]">
                    {row.shipment?.status.toLowerCase()} from {row.shipment?.pharmacy}
                  </span>
                </li>
              ))}
              {alreadyShipped.length > 5 ? (
                <li className="text-[0.8rem] text-[var(--ar-text-faint)]">
                  and {alreadyShipped.length - 5} more
                </li>
              ) : null}
            </ul>

            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[0.85rem] text-[var(--ar-body-color)]">
              <input
                type="checkbox"
                checked={acceptSecondParcel}
                onChange={(event) => setAcceptSecondParcel(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand a second parcel will be sent from another pharmacy for{' '}
                {alreadyShipped.length === 1
                  ? 'this patient'
                  : `these ${alreadyShipped.length} patients`}
                .
              </span>
            </label>
          </div>
        ) : null}

        {outcome ? (
          <div className="space-y-4">
            <p className="text-[0.9rem]">
              <strong>{outcome.moved.length}</strong> moved
              {outcome.skipped.length ? (
                <>
                  , <strong>{outcome.skipped.length}</strong> left where they were
                </>
              ) : null}
              .
            </p>

            {outcome.moved.some((row) => !row.transmitted) ? (
              <Notice>
                Some were queued rather than sent — the receiving pharmacy has no working
                connection. They are in that pharmacy&rsquo;s fill queue and will show under Stuck
                orders.
              </Notice>
            ) : null}

            {outcome.moved.some((row) => row.warning) ? (
              <Notice>
                At least one had already been accepted by the original pharmacy. Contact them to
                cancel, or the patient may receive two parcels.
              </Notice>
            ) : null}

            {outcome.skipped.length ? (
              <div>
                <p className="mb-1.5 text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
                  Not moved
                </p>
                <ul className="space-y-1">
                  {outcome.skipped.map((row) => {
                    const prescription = selected.find((entry) => entry.id === row.prescriptionId);
                    return (
                      <li
                        key={row.prescriptionId}
                        className="text-[0.85rem] text-[var(--ar-text-muted)]"
                      >
                        <span className="font-medium text-[var(--ar-body-color)]">
                          {prescription?.medication ?? row.prescriptionId.slice(0, 8)}
                        </span>
                        {prescription ? ` for ${prescription.patient.name}` : ''} — {row.why}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mb-4 max-h-40 overflow-y-auto rounded-[var(--ar-radius)] bg-[var(--ar-body-bg)] px-4 py-3">
              <ul className="space-y-1">
                {selected.slice(0, 12).map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline justify-between gap-3 text-[0.82rem]"
                  >
                    <span>
                      <span className="font-medium text-[var(--ar-headings)]">
                        {row.medication}
                      </span>
                      <span className="text-[var(--ar-text-muted)]"> · {row.patient.name}</span>
                    </span>
                    <Badge tone="neutral">{row.shipment?.pharmacy ?? 'not dispatched'}</Badge>
                  </li>
                ))}
                {selected.length > 12 ? (
                  <li className="text-[0.8rem] text-[var(--ar-text-faint)]">
                    and {selected.length - 12} more
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="grid gap-4">
              <Field
                label="Send them to"
                hint="Anything the receiving pharmacy cannot dispense or does not stock is reported back rather than moved."
              >
                <SimpleSelect
                  value={choice}
                  onValueChange={setChoice}
                  placeholder={pharmacies === null ? 'Loading…' : 'Choose a pharmacy'}
                  options={(pharmacies ?? []).map((pharmacy) => ({
                    value: pharmacy.id,
                    label: pharmacy.name,
                    hint: [
                      pharmacy.dispensesCompounded ? 'compounded' : null,
                      pharmacy.dispensesBranded ? 'branded' : null,
                      pharmacy.statesServed?.length ? pharmacy.statesServed.join(', ') : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                />
              </Field>

              <Field
                label="Reason"
                hint="Written to the audit log against every prescription moved."
              >
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why are these being moved?"
                />
              </Field>
            </div>

            <div className="mt-4">
              <Notice>
                The order at the current pharmacy is cancelled and a new one raised at the pharmacy
                you choose.{' '}
                {alreadyShipped.length
                  ? 'Anything already shipped is confirmed above before it moves.'
                  : 'Anything already shipped is refused, because rerouting it would send a second parcel.'}
              </Notice>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-3.5 py-3">
      <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
      <p className="text-[0.82rem] leading-relaxed text-[#8A4B0A]">{children}</p>
    </div>
  );
}
