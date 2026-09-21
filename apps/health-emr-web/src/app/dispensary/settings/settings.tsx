'use client';

import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Skeleton,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { SimpleSelect } from '@/components/ui/select';
import { PasswordInput } from '@/components/ui/password-input';
import { MaskedInput } from '@/components/ui/masked-input';
import { AlertTriangleIcon, CheckCircleIcon, EditIcon, SaveIcon } from '@/components/ui/icons';
import { formatDateShort } from '@/lib/format';
import { Figure } from '@/components/ui/figure';

interface Profile {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  contactPhone: string | null;
  ncpdpId: string | null;
  statesServed: string[];
  dispensesCompounded: boolean;
  dispensesBranded: boolean;
  status: string;
  createdAt: string;
  catalogue: { categories: number; products: number };
  clients: number;
  orders: Record<string, number>;
  shipped: number;
}

interface Integration {
  pharmacy: string;
  platform: string;
  configured: boolean;
  config: {
    baseUrl: string;
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
  ordersWithErrors: number;
}

/**
 * A pharmacy's own record and connection.
 *
 * Both are editable here because both are things only this pharmacy knows: their
 * contact details, the states they ship into, and the credentials to their own
 * system. What they cannot change is what they are permitted to dispense —
 * that decides which prescriptions may be routed here at all, and is shown
 * read-only so it is clear it exists rather than appearing to be missing.
 */
export function PharmacySettings() {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [integration, setIntegration] = React.useState<Integration | null>(null);
  const [editing, setEditing] = React.useState<'profile' | 'connection' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    Promise.all([
      api<Profile>('v1/dispensary/profile'),
      api<Integration>('v1/dispensary/integration'),
    ])
      .then(([p, i]) => {
        setProfile(p);
        setIntegration(i);
      })
      .catch(() => setError('Could not load your settings.'));
  }, []);

  React.useEffect(load, [load]);

  if (!profile || !integration) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const config = integration.config;
  const live = Boolean(config?.isEnabled && integration.credentialsResolve);
  const open = Object.entries(profile.orders)
    .filter(([status]) => ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'].includes(status))
    .reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">{saved}</Alert> : null}

      <Card>
        <CardHeader
          title="Profile"
          subtitle="How we reach you, and where you ship."
          action={
            <Button
              variant="outline"
              size="sm"
              icon={EditIcon}
              onClick={() => setEditing('profile')}
            >
              Edit
            </Button>
          }
        />
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          <Detail term="Name" value={profile.name} />
          <Detail term="Contact email" value={profile.contactEmail ?? '—'} />
          <Detail term="Contact phone" value={profile.contactPhone ?? '—'} />
          <Detail term="NCPDP ID" value={profile.ncpdpId ?? '—'} />
          <Detail term="Ships to" value={profile.statesServed.join(', ') || 'no states listed'} />
          <Detail term="On the platform since" value={formatDateShort(profile.createdAt)} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--ar-border-soft)] pt-4">
          <span className="text-[0.78rem] text-[var(--ar-text-faint)]">Permitted to dispense:</span>
          {profile.dispensesCompounded ? <Badge tone="info">compounded</Badge> : null}
          {profile.dispensesBranded ? <Badge tone="info">branded</Badge> : null}
          {!profile.dispensesCompounded && !profile.dispensesBranded ? (
            <Badge tone="warning">nothing set</Badge>
          ) : null}
          <span className="text-[0.75rem] text-[var(--ar-text-faint)]">
            — set by the platform, because it decides what may be routed to you.
          </span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Figure label="Open orders" value={open} />
          <Figure label="Shipped" value={profile.shipped} />
          <Figure
            label="Products"
            value={profile.catalogue.products}
            hint={`${profile.catalogue.categories} categories`}
          />
          <Figure label="Clients served" value={profile.clients} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Connection to your system"
          subtitle="Where we send a prescription the moment a provider approves it."
          action={
            <Button
              variant="outline"
              size="sm"
              icon={EditIcon}
              onClick={() => setEditing('connection')}
            >
              {config ? 'Edit connection' : 'Connect'}
            </Button>
          }
        />

        {!config ? (
          <Warning>
            No connection configured. Orders will wait in your fill queue, but nothing will be sent
            to your own system.
          </Warning>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone={live ? 'success' : 'warning'}>
                {live
                  ? 'live — orders are sent'
                  : config.isEnabled
                    ? 'on, but no login works'
                    : 'switched off'}
              </Badge>
              <Badge tone="primary">{integration.platform}</Badge>
              {config.hasStoredCredentials ? (
                <span className="inline-flex items-center gap-1 text-[0.78rem] text-[var(--ar-on-success)]">
                  <CheckCircleIcon size={14} /> login saved
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[0.78rem] text-[var(--ar-on-warning)]">
                  <AlertTriangleIcon size={14} /> no login saved
                </span>
              )}
              {integration.ordersWithErrors > 0 ? (
                <Badge tone="danger">{integration.ordersWithErrors} orders failed to send</Badge>
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
                value={config.defaultShippingService ?? 'your default'}
              />
            </dl>
          </>
        )}
      </Card>

      {editing === 'profile' ? (
        <ProfileDialog
          profile={profile}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSaved('Profile saved.');
            load();
          }}
        />
      ) : null}

      {editing === 'connection' ? (
        <ConnectionDialog
          config={config}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSaved('Connection saved.');
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function ProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    ncpdpId: profile.ncpdpId ?? '',
    statesServed: profile.statesServed.join(', '),
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('v1/dispensary/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          contactEmail: form.contactEmail.trim() || null,
          contactPhone: form.contactPhone.trim() || null,
          ncpdpId: form.ncpdpId.trim() || null,
          statesServed: form.statesServed
            .split(/[,\s]+/)
            .map((state) => state.trim().toUpperCase())
            .filter(Boolean),
        }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit pharmacy details"
      description="How the platform reaches you, and which states you will ship into."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={SaveIcon} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save details'}
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
        <Field label="Contact email">
          <Input
            type="email"
            value={form.contactEmail}
            onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
          />
        </Field>
        <Field label="Contact phone">
          <MaskedInput
            mask="phone"
            value={form.contactPhone}
            onValueChange={(raw) => setForm({ ...form, contactPhone: raw })}
          />
        </Field>
        <Field label="NCPDP ID">
          <Input
            value={form.ncpdpId}
            onChange={(event) => setForm({ ...form, ncpdpId: event.target.value })}
          />
        </Field>
        <Field label="States you ship to" hint="Two-letter codes, comma separated.">
          <Input
            value={form.statesServed}
            onChange={(event) => setForm({ ...form, statesServed: event.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

function ConnectionDialog({
  config,
  onClose,
  onSaved,
}: {
  config: Integration['config'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('v1/dispensary/integration', {
        method: 'PUT',
        body: JSON.stringify({
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

  return (
    <Modal
      open
      onClose={onClose}
      title="Connection to your system"
      description={[
        'Orders arrive here the moment a provider approves them.',
        'Your password is encrypted before it is stored and is never shown again — not even to you.',
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
        <div className="sm:col-span-2">
          <Field label="Base URL" hint="“/order” is appended when we send one.">
            <Input value={form.baseUrl} onChange={(event) => set('baseUrl')(event.target.value)} />
          </Field>
        </div>
        <Field
          label="Username"
          hint={config?.hasStoredCredentials ? 'Leave blank to keep the saved login.' : undefined}
        >
          <Input
            autoComplete="off"
            value={form.username}
            placeholder={config?.hasStoredCredentials ? '•••••• saved' : ''}
            onChange={(event) => set('username')(event.target.value)}
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            autoComplete="new-password"
            value={form.password}
            placeholder={config?.hasStoredCredentials ? '•••••• saved' : ''}
            onChange={(event) => set('password')(event.target.value)}
          />
        </Field>
        <Field label="Vendor ID">
          <Input value={form.vendorId} onChange={(event) => set('vendorId')(event.target.value)} />
        </Field>
        <Field label="Location ID">
          <Input
            value={form.locationId}
            onChange={(event) => set('locationId')(event.target.value)}
          />
        </Field>
        <Field label="API network ID">
          <Input
            value={form.apiNetworkId}
            onChange={(event) => set('apiNetworkId')(event.target.value)}
          />
        </Field>
        <Field label="Practice ID">
          <Input
            value={form.practiceId}
            onChange={(event) => set('practiceId')(event.target.value)}
          />
        </Field>
        <Field label="Default shipping service" hint="Optional.">
          <Input
            value={form.defaultShippingService}
            onChange={(event) => set('defaultShippingService')(event.target.value)}
          />
        </Field>
        <Field
          label="Receive orders automatically"
          hint="Off means they wait in your fill queue only."
        >
          <SimpleSelect
            value={form.isEnabled}
            onValueChange={set('isEnabled')}
            options={[
              { value: 'true', label: 'Yes — send them to my system' },
              { value: 'false', label: 'No — fill queue only' },
            ]}
          />
        </Field>
      </div>
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

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-4 py-3">
      <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
      <p className="text-[0.85rem] leading-relaxed text-[#8A4B0A]">{children}</p>
    </div>
  );
}
