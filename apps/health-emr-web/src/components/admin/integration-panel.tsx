'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { PasswordInput } from '@/components/ui/password-input';
import { AlertTriangleIcon, CheckCircleIcon, EditIcon, SaveIcon } from '@/components/ui/icons';

interface Integration {
  configured: boolean;
  platform?: string;
  config: {
    baseUrl: string;
    credentialRef: string;
    vendorId: string | null;
    locationId: string | null;
    apiNetworkId: string | null;
    practiceId: string | null;
    defaultShippingService: string | null;
    timeoutMs: number;
    isEnabled: boolean;
    hasStoredCredentials: boolean;
  } | null;
  credentialsResolve: boolean;
  lastSubmitted: {
    id: string;
    submittedAt: string | null;
    externalOrderId: string | null;
    externalRxNumber: string | null;
  } | null;
  ordersWithErrors: number;
}

const PLATFORMS = [
  { value: 'LIFEFILE', label: 'LifeFile', hint: 'Most compounding pharmacies' },
  { value: 'GENERIC_HTTP', label: 'Generic HTTP', hint: 'A custom endpoint' },
];

/**
 * How signed prescriptions reach this pharmacy.
 *
 * Every LifeFile pharmacy receives the same order payload — what differs is the
 * login and the routing ids, which is why those are per pharmacy and the format
 * is not. The password is written and never read back: this panel can tell you
 * one is on file, and nothing more.
 */
export function IntegrationPanel({
  pharmacyId,
  pharmacyName,
}: {
  pharmacyId: string;
  pharmacyName: string;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<Integration | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  /** False until the first answer, so "not configured" is never claimed early. */
  const [loaded, setLoaded] = React.useState(false);

  const load = React.useCallback(() => {
    api<Integration>(`v1/super-admin/pharmacies/${pharmacyId}/integration`)
      .then(setState)
      .catch(() => setError('Could not read the integration settings.'))
      .finally(() => setLoaded(true));
  }, [pharmacyId]);

  React.useEffect(load, [load]);

  const config = state?.config;
  const live = Boolean(config?.isEnabled && state?.credentialsResolve);

  return (
    <Card>
      <CardHeader
        title="Pharmacy integration"
        subtitle="Where a signed prescription is transmitted the moment a provider approves it."
        action={
          <Button
            variant="outline"
            size="sm"
            icon={EditIcon}
            onClick={() => {
              setSaved(false);
              setError(null);
              setOpen(true);
            }}
          >
            {config ? 'Edit connection' : 'Connect'}
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {!loaded ? (
        // "No connection configured" is an alarming thing to read, and it used
        // to appear for a moment on every pharmacy that had one.
        <div className="flex flex-col gap-2.5">
          <div className="ar-skeleton h-6 w-40" />
          <div className="ar-skeleton h-4 w-full" />
          <div className="ar-skeleton h-4 w-2/3" />
        </div>
      ) : !config ? (
        <div className="flex items-start gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-4 py-3">
          <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
          <p className="text-[0.85rem] leading-relaxed text-[#8A4B0A]">
            No connection configured. Orders for {pharmacyName} will queue in their fill queue but
            will not reach their own system.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={live ? 'success' : 'warning'}>
              {live
                ? 'live — orders transmit'
                : config.isEnabled
                  ? 'enabled, no credentials'
                  : 'switched off'}
            </Badge>
            <Badge tone="primary">{state?.platform ?? 'LIFEFILE'}</Badge>
            {config.hasStoredCredentials ? (
              <span className="inline-flex items-center gap-1 text-[0.78rem] text-[var(--ar-on-success)]">
                <CheckCircleIcon size={14} /> credentials on file
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[0.78rem] text-[var(--ar-on-warning)]">
                <AlertTriangleIcon size={14} /> no credentials
              </span>
            )}
            {state && state.ordersWithErrors > 0 ? (
              <Badge tone="danger">{state.ordersWithErrors} orders with errors</Badge>
            ) : null}
          </div>

          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            <Detail term="Endpoint" value={`${config.baseUrl.replace(/\/+$/, '')}/order`} />
            <Detail term="Vendor ID" value={config.vendorId ?? '—'} />
            <Detail term="Location ID" value={config.locationId ?? '—'} />
            <Detail term="API network ID" value={config.apiNetworkId ?? '—'} />
            <Detail term="Practice ID" value={config.practiceId ?? '—'} />
            <Detail
              term="Shipping service"
              value={config.defaultShippingService ?? 'pharmacy default'}
            />
            <Detail
              term="Last accepted"
              value={
                state?.lastSubmitted?.submittedAt
                  ? `${state.lastSubmitted.externalOrderId ?? 'order'} · ${new Date(
                      state.lastSubmitted.submittedAt,
                    )
                      .toISOString()
                      .slice(0, 10)}`
                  : 'nothing yet'
              }
            />
          </dl>
        </>
      )}

      {open ? (
        <ConnectionDialog
          pharmacyId={pharmacyId}
          pharmacyName={pharmacyName}
          config={config ?? null}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setSaved(true);
            load();
            router.refresh();
          }}
        />
      ) : null}

      {saved ? (
        <div className="mt-4">
          <Alert tone="success">Connection saved.</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function ConnectionDialog({
  pharmacyId,
  pharmacyName,
  config,
  busy,
  setBusy,
  onClose,
  onSaved,
}: {
  pharmacyId: string;
  pharmacyName: string;
  config: Integration['config'];
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    platform: 'LIFEFILE',
    baseUrl: config?.baseUrl ?? 'https://api.lifefile.net/v1',
    vendorId: config?.vendorId ?? '',
    locationId: config?.locationId ?? '',
    apiNetworkId: config?.apiNetworkId ?? '',
    practiceId: config?.practiceId ?? '',
    defaultShippingService: config?.defaultShippingService ?? '',
    timeoutMs: String(config?.timeoutMs ?? 20000),
    isEnabled: config?.isEnabled ? 'true' : 'false',
    username: '',
    password: '',
  });
  const [error, setError] = React.useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`v1/super-admin/pharmacies/${pharmacyId}/integration`, {
        method: 'PUT',
        body: JSON.stringify({
          credentialRef: `pharmacy-${pharmacyId.slice(0, 8)}`,
          baseUrl: form.baseUrl.trim(),
          vendorId: form.vendorId.trim() || null,
          locationId: form.locationId.trim() || null,
          apiNetworkId: form.apiNetworkId.trim() || null,
          practiceId: form.practiceId.trim() || null,
          defaultShippingService: form.defaultShippingService.trim() || null,
          timeoutMs: Number(form.timeoutMs),
          isEnabled: form.isEnabled === 'true',
          ...(form.username.trim() && form.password
            ? { username: form.username.trim(), password: form.password }
            : {}),
        }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const needsCredentials = !config?.hasStoredCredentials && !(form.username && form.password);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Connect ${pharmacyName}`}
      description={[
        'Every LifeFile pharmacy receives the same order format.',
        'What is specific to this one is its login and its routing ids.',
      ]}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={SaveIcon} onClick={save} disabled={busy || !form.baseUrl.trim()}>
            {busy ? 'Saving…' : 'Save connection'}
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
        <Field label="Pharmacy system" hint="LifeFile is what most compounding pharmacies run.">
          <SimpleSelect value={form.platform} onValueChange={set('platform')} options={PLATFORMS} />
        </Field>
        <Field label="Transmit orders" hint="Nothing leaves the platform until this is on.">
          <SimpleSelect
            value={form.isEnabled}
            onValueChange={set('isEnabled')}
            options={[
              { value: 'true', label: 'Yes — send orders to this pharmacy' },
              {
                value: 'false',
                label: 'No — hold them in the fill queue only',
              },
            ]}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Base URL" hint="“/order” is appended when an order is sent.">
            <Input value={form.baseUrl} onChange={(event) => set('baseUrl')(event.target.value)} />
          </Field>
        </div>

        <Field
          label="Username"
          hint={
            config?.hasStoredCredentials
              ? 'Leave blank to keep the stored login.'
              : 'From the pharmacy.'
          }
        >
          <Input
            value={form.username}
            autoComplete="off"
            placeholder={config?.hasStoredCredentials ? '•••••• stored' : ''}
            onChange={(event) => set('username')(event.target.value)}
          />
        </Field>
        <Field
          label="Password"
          hint="Encrypted before it is stored, and never shown again — not even here."
        >
          <PasswordInput
            value={form.password}
            autoComplete="new-password"
            placeholder={config?.hasStoredCredentials ? '•••••• stored' : ''}
            onChange={(event) => set('password')(event.target.value)}
          />
        </Field>

        <Field label="Vendor ID" hint="Sent as X-Vendor-ID.">
          <Input value={form.vendorId} onChange={(event) => set('vendorId')(event.target.value)} />
        </Field>
        <Field label="Location ID" hint="Sent as X-Location-ID.">
          <Input
            value={form.locationId}
            onChange={(event) => set('locationId')(event.target.value)}
          />
        </Field>
        <Field label="API network ID" hint="Sent as X-API-Network-ID.">
          <Input
            value={form.apiNetworkId}
            onChange={(event) => set('apiNetworkId')(event.target.value)}
          />
        </Field>
        <Field label="Practice ID" hint="Which practice the order belongs to.">
          <Input
            value={form.practiceId}
            onChange={(event) => set('practiceId')(event.target.value)}
          />
        </Field>
        <Field label="Shipping service" hint="Their code for the default service. Optional.">
          <Input
            value={form.defaultShippingService}
            onChange={(event) => set('defaultShippingService')(event.target.value)}
          />
        </Field>
        <Field label="Timeout (ms)" hint="How long to wait before giving up on one attempt.">
          <Input
            type="number"
            value={form.timeoutMs}
            onChange={(event) => set('timeoutMs')(event.target.value)}
          />
        </Field>
      </div>

      {form.isEnabled === 'true' && needsCredentials ? (
        <div className="mt-4 flex gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-3.5 py-3">
          <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
          <p className="text-[0.82rem] leading-relaxed text-[#8A4B0A]">
            Transmission is switched on but there is no login on file. Orders will queue with an
            error until a username and password are saved.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
        {term}
      </dt>
      <dd className="mt-0.5 break-words text-[0.875rem] text-[var(--ar-body-color)]">{value}</dd>
    </div>
  );
}
