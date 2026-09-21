'use client';

import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Skeleton } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { CheckIcon, CopyIcon, DownloadIcon } from '@/components/ui/icons';

interface Payload {
  orderId: string;
  pharmacy: string;
  platform: string;
  endpoint: string | null;
  status: string;
  attempts: number;
  submittedAt: string | null;
  externalOrderId: string | null;
  externalRxNumber: string | null;
  lastError: string | null;
  payload: unknown;
}

/**
 * Exactly what was posted to the pharmacy, and what they said back.
 *
 * The question this answers is "they say they never received it" — and the
 * only useful answer is the request body as it actually went, rather than a
 * reconstruction of what it should have been.
 *
 * It is full PHI: a name, a date of birth, a home address. The read is recorded
 * as break-the-glass by the API, and the dialog says so, because somebody
 * opening it to debug an integration should know it lands in the audit trail.
 */
export function OrderPayloadButton({
  orderId,
  label = 'What we sent',
}: {
  orderId: string;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="outline" size="sm" icon={DownloadIcon} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <PayloadDialog orderId={orderId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PayloadDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api<Payload>(`v1/super-admin/orders/${orderId}/payload`)
      .then((body) => live && setData(body))
      .catch((caught: unknown) =>
        live ? setError(caught instanceof ApiError ? caught.message : (caught as Error).message) : undefined,
      );
    return () => {
      live = false;
    };
  }, [orderId]);

  const json = data?.payload ? JSON.stringify(data.payload, null, 2) : null;

  const copy = async () => {
    if (!json) return;
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="What we sent the pharmacy"
      description="The request body exactly as it was posted, and their answer."
      width="lg"
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!data && !error ? <Skeleton className="h-64" /> : null}

      {data ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.85rem] md:grid-cols-3">
            <Detail label="Pharmacy">
              {data.pharmacy} <Badge tone="info">{data.platform}</Badge>
            </Detail>
            <Detail label="Attempts">{data.attempts}</Detail>
            <Detail label="Their order id">{data.externalOrderId ?? '—'}</Detail>
            <Detail label="Their Rx number">{data.externalRxNumber ?? '—'}</Detail>
            <Detail label="Sent at">
              {data.submittedAt ? new Date(data.submittedAt).toLocaleString() : 'not yet'}
            </Detail>
            <Detail label="Posted to">
              {data.endpoint ? (
                <code className="break-all text-[0.75rem]">{data.endpoint}</code>
              ) : (
                'no live integration — worked from our console'
              )}
            </Detail>
          </dl>

          {data.lastError ? <Alert tone="warning">{data.lastError}</Alert> : null}

          <p className="text-[0.78rem] text-[var(--ar-text-muted)]">
            This is patient health information, and opening it is recorded against the chart.
          </p>

          {json ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.78rem] text-[var(--ar-text-muted)]">
                  The request body, exactly as it went.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  icon={copied ? CheckIcon : CopyIcon}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="max-h-[26rem] overflow-auto rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-gray-50)] p-3 text-[0.75rem] leading-relaxed">
                {json}
              </pre>
            </>
          ) : (
            <Alert tone="info">
              Nothing has been sent for this order yet, so there is no request body to show.
            </Alert>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ar-text-faint)]">
        {label}
      </dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">{children}</dd>
    </div>
  );
}
