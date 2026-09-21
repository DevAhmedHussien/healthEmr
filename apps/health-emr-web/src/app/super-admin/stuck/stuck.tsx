'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Skeleton,
  TableWrap,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { OrderPayloadButton } from '@/components/admin/order-payload';
import { AlertTriangleIcon, MortarIcon, RefreshIcon } from '@/components/ui/icons';

interface StuckOrder {
  id: string;
  status: string;
  pharmacy: { id: string; name: string };
  tenant: string;
  medication: string;
  kitCode: string | null;
  patient: string;
  mrn: string;
  signedAt: string;
  queuedAt: string;
  waitingHours: number;
  attempts: number;
  lastError: string | null;
  reason: string;
}

interface Candidate {
  id: string;
  name: string;
  statesServed: string[];
  transmits: boolean;
  eligible: boolean;
  blockers: string[];
}

interface RerouteResult {
  fromPharmacy: string;
  toPharmacy: string;
  transmitted: boolean;
  transmissionError: string | null;
  warning: string | null;
}

/**
 * Orders nobody is working.
 *
 * A signed prescription that never reached a pharmacy is invisible everywhere
 * else: the client sees an approved visit, the pharmacy sees a queue they are
 * not watching, and the patient sees nothing at all. The only useful action is
 * to send it somewhere that can fill it, so that is the action on the row.
 */
export function StuckOrders() {
  const router = useRouter();
  const [orders, setOrders] = React.useState<StuckOrder[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<React.ReactNode>(null);
  const [rerouting, setRerouting] = React.useState<StuckOrder | null>(null);

  const load = React.useCallback(() => {
    api<{ data: StuckOrder[] }>('v1/super-admin/orders/stuck')
      .then((response) => setOrders(response.data))
      .catch(() => setError('Could not load stuck orders.'));
  }, []);

  React.useEffect(load, [load]);

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <Card className="p-0">
        <div className="p-6 pb-3">
          <CardHeader
            title="Stuck orders"
            subtitle="Signed prescriptions that have not reached a pharmacy's system."
            action={
              <Button variant="outline" size="sm" icon={RefreshIcon} onClick={load}>
                Refresh
              </Button>
            }
          />
        </div>

        {orders === null ? (
          <div className="space-y-2 px-6 pb-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            title="Nothing stuck"
            hint="Every signed prescription has reached the pharmacy it was routed to."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">Waiting</th>
                <th scope="col">Medication</th>
                <th scope="col">Patient</th>
                <th scope="col">Pharmacy</th>
                <th scope="col">Why</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span
                      className={
                        order.waitingHours >= 24
                          ? 'font-medium tabular-nums text-[var(--ar-danger)]'
                          : 'tabular-nums'
                      }
                    >
                      {order.waitingHours}h
                    </span>
                    <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                      {order.attempts} attempt{order.attempts === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td>
                    <span className="font-medium text-[var(--ar-headings)]">
                      {order.medication}
                    </span>
                    {order.kitCode ? (
                      <span className="block text-[0.72rem] tabular-nums text-[var(--ar-text-faint)]">
                        kit {order.kitCode}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {order.patient}
                    <span className="block text-[0.72rem] tabular-nums text-[var(--ar-text-faint)]">
                      {order.mrn} · {order.tenant}
                    </span>
                  </td>
                  <td>{order.pharmacy.name}</td>
                  <td>
                    <Badge tone={order.lastError ? 'danger' : 'warning'}>{order.reason}</Badge>
                    {order.lastError ? (
                      <span className="mt-1 block text-[0.72rem] text-[var(--ar-text-muted)]">
                        {order.lastError}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <OrderPayloadButton orderId={order.id} />
                      <Button
                        size="sm"
                        icon={MortarIcon}
                        onClick={() => {
                          setNotice(null);
                          setRerouting(order);
                        }}
                      >
                        Send elsewhere
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {rerouting ? (
        <RerouteDialog
          order={rerouting}
          onClose={() => setRerouting(null)}
          onDone={(result) => {
            setRerouting(null);
            setNotice(
              <>
                Moved {result.fromPharmacy} → <strong>{result.toPharmacy}</strong>.{' '}
                {result.transmitted
                  ? 'It has been sent to their system.'
                  : `It is queued there${result.transmissionError ? ` — ${result.transmissionError}` : ''}.`}
                {result.warning ? (
                  <span className="mt-1 flex items-start gap-1.5">
                    <AlertTriangleIcon size={14} className="mt-0.5 flex-none" />
                    {result.warning}
                  </span>
                ) : null}
              </>,
            );
            load();
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RerouteDialog({
  order,
  onClose,
  onDone,
}: {
  order: StuckOrder;
  onClose: () => void;
  onDone: (result: RerouteResult) => void;
}) {
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [choice, setChoice] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<Candidate[]>(`v1/super-admin/orders/${order.id}/reroute-options`)
      .then(setCandidates)
      .catch(() => setError('Could not load the other pharmacies.'));
  }, [order.id]);

  const eligible = (candidates ?? []).filter((candidate) => candidate.eligible);
  const blocked = (candidates ?? []).filter((candidate) => !candidate.eligible);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<RerouteResult>(`v1/super-admin/orders/${order.id}/reroute`, {
        method: 'POST',
        body: JSON.stringify({ pharmacyId: choice, reason: reason.trim() }),
      });
      onDone(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Send this order to a different pharmacy"
      description={`${order.medication} for ${order.patient}, stuck at ${order.pharmacy.name} for ${order.waitingHours} hours.`}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            icon={MortarIcon}
            onClick={send}
            disabled={busy || !choice || reason.trim().length < 10}
          >
            {busy ? 'Moving…' : 'Reroute order'}
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
        <Field
          label="Send it to"
          hint="Only pharmacies that can dispense this product and stock the kit are offered."
        >
          <SimpleSelect
            value={choice}
            onValueChange={setChoice}
            placeholder={
              candidates === null
                ? 'Loading…'
                : eligible.length
                  ? 'Choose a pharmacy'
                  : 'No other pharmacy can take this order'
            }
            disabled={candidates !== null && eligible.length === 0}
            options={eligible.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
              hint: [
                candidate.transmits ? 'sends automatically' : 'fill queue only',
                candidate.statesServed.join(', ') || 'no states listed',
              ].join(' · '),
            }))}
          />
        </Field>

        <Field label="Reason" hint="Written to the audit log. At least 10 characters.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this being moved?"
          />
        </Field>
      </div>

      {blocked.length ? (
        <div className="mt-4 rounded-[var(--ar-radius)] bg-[var(--ar-body-bg)] px-4 py-3">
          <p className="text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
            Cannot take this order
          </p>
          <ul className="mt-1.5 space-y-1">
            {blocked.map((candidate) => (
              <li key={candidate.id} className="text-[0.8rem] text-[var(--ar-text-muted)]">
                <span className="font-medium">{candidate.name}</span> —{' '}
                {candidate.blockers.join('; ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-3.5 py-3">
        <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
        <p className="text-[0.82rem] leading-relaxed text-[#8A4B0A]">
          The order at {order.pharmacy.name} is cancelled and a new one is raised at the pharmacy
          you choose. If they had already accepted it, you will need to tell them to cancel —
          otherwise the patient receives two parcels.
        </p>
      </div>
    </Modal>
  );
}
