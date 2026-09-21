'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { AlertTriangleIcon, PackageIcon } from '@/components/ui/icons';

const CARRIERS = ['FEDEX', 'UPS', 'USPS', 'DHL', 'COURIER', 'OTHER'];
const REASONS = [
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'CLINICAL_CONCERN', label: 'Clinical concern' },
  { value: 'ADDRESS_PROBLEM', label: 'Address problem' },
  { value: 'PRESCRIPTION_UNCLEAR', label: 'Prescription unclear' },
  { value: 'PATIENT_UNREACHABLE', label: 'Patient unreachable' },
  { value: 'OTHER', label: 'Something else' },
];

export interface QueueRow {
  id: string;
  status: string;
  medication: string;
  patient: { name: string; mrn: string; shipTo: string; allergies: string[] };
  directions: string;
  carrier: string | null;
  trackingNumber: string | null;
}

/**
 * The per-row actions on the fill queue.
 *
 * In a dialog rather than expanding the row, because both actions need context a
 * table cell has no room for — the ship-to address and the patient's allergies —
 * and a pharmacist confirming a shipment should see them at the moment they
 * confirm it, not have to remember them from a screen they scrolled past.
 */
export function OrderRowActions({ row, onDone }: { row: QueueRow; onDone: () => void }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<'ship' | 'issue' | null>(null);
  const [carrier, setCarrier] = React.useState(row.carrier ?? 'FEDEX');
  const [tracking, setTracking] = React.useState(row.trackingNumber ?? '');
  const [reason, setReason] = React.useState('OUT_OF_STOCK');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const shipped = ['SHIPPED', 'DELIVERED', 'CANCELLED', 'REJECTED'].includes(row.status);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode(null);
      onDone();
      router.refresh();
    } catch (caught) {
      const detail =
        caught instanceof ApiError && Array.isArray(caught.details)
          ? (caught.details as Array<{ message: string }>).map((issue) => issue.message).join(' · ')
          : (caught as Error).message;
      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
      <Button
        size="sm"
        variant={shipped ? 'ghost' : 'primary'}
        icon={PackageIcon}
        disabled={shipped}
        onClick={() => {
          setError(null);
          setMode('ship');
        }}
      >
        {shipped ? 'Shipped' : 'Ship'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={AlertTriangleIcon}
        aria-label={`Raise an issue with ${row.medication} for ${row.patient.name}`}
        onClick={() => {
          setError(null);
          setMode('issue');
        }}
      />

      <Modal
        open={mode === 'ship'}
        onClose={() => setMode(null)}
        title="Record a shipment"
        description={[
          'The tracking number is checked against the carrier’s format before it is accepted.',
          'A typo here is a patient who cannot find their parcel.',
        ]}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              icon={PackageIcon}
              disabled={busy || !tracking.trim()}
              onClick={() =>
                run(() =>
                  api(`v1/dispensary/orders/${row.id}/ship`, {
                    method: 'POST',
                    body: JSON.stringify({
                      carrier,
                      trackingNumber: tracking.trim(),
                    }),
                  }),
                )
              }
            >
              {busy ? 'Saving…' : 'Mark shipped'}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <OrderSummary row={row} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Carrier">
            <SimpleSelect
              value={carrier}
              onValueChange={setCarrier}
              options={CARRIERS.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Tracking number">
            <Input
              autoFocus
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={mode === 'issue'}
        onClose={() => setMode(null)}
        title="Raise an issue"
        tone="danger"
        description={[
          'Opens a conversation with the platform team about this order.',
          'The patient is not notified.',
        ]}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={AlertTriangleIcon}
              disabled={busy || message.trim().length < 5}
              onClick={() =>
                run(() =>
                  api(`v1/dispensary/orders/${row.id}/issue`, {
                    method: 'POST',
                    body: JSON.stringify({ reason, message: message.trim() }),
                  }),
                )
              }
            >
              {busy ? 'Sending…' : 'Raise issue'}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <OrderSummary row={row} />

        <div className="mt-4 grid gap-4">
          <Field label="What is the problem?">
            <SimpleSelect value={reason} onValueChange={setReason} options={REASONS} />
          </Field>
          <Field label="Tell the platform team what you are seeing">
            <Textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What you found, and what you need from us."
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/** The bits of the order somebody needs in front of them to act on it. */
function OrderSummary({ row }: { row: QueueRow }) {
  return (
    <div className="rounded-[var(--ar-radius)] bg-[var(--ar-body-bg)] px-4 py-3">
      <p className="font-medium text-[var(--ar-headings)]">{row.medication}</p>
      <p className="mt-0.5 text-[0.82rem] text-[var(--ar-text-muted)]">{row.directions}</p>
      <p className="mt-2 text-[0.82rem]">
        <span className="text-[var(--ar-text-faint)]">For </span>
        {row.patient.name}
        <span className="tabular-nums text-[var(--ar-text-faint)]"> · {row.patient.mrn}</span>
      </p>
      <p className="mt-0.5 text-[0.82rem] text-[var(--ar-text-muted)]">{row.patient.shipTo}</p>
      {row.patient.allergies.length ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-on-warning)]">
            Allergies
          </span>
          {row.patient.allergies.map((allergy) => (
            <Badge key={allergy} tone="warning">
              {allergy}
            </Badge>
          ))}
        </p>
      ) : null}
    </div>
  );
}
