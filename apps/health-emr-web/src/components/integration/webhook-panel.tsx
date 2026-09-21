'use client';

import * as React from 'react';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL, type WebhookEvent } from '@health-emr/types';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  TableWrap,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { Form } from '@/components/form/form';
import { TextField, PasswordField } from '@/components/form/fields';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  TrashIcon,
} from '@/components/ui/icons';
import { formatDateShort } from '@/lib/format';
import { z } from 'zod';

interface Endpoint {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  disabled: boolean;
  disabledReason: string | null;
  failureCount: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  deliveries: number;
  hasAuthToken: boolean;
}

const EVENT_OPTIONS = WEBHOOK_EVENTS.map((event) => ({
  value: event,
  label: WEBHOOK_EVENT_LABEL[event],
  hint: event,
}));

/**
 * Where this client business is told what happened.
 *
 * The platform already narrates a visit to the patient in their chat thread.
 * This sends the same moments to the client's own systems, so their CRM can
 * show a patient and a salesperson where a visit got to without anybody copying
 * a status between two screens.
 *
 * Only the platform owner reaches this. The endpoint receives patient
 * information, so pointing it somewhere new is a disclosure decision rather
 * than a preference a client changes for itself.
 */
export function WebhookPanel({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = React.useState<Endpoint[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Endpoint | 'new' | null>(null);
  const [secret, setSecret] = React.useState<{ name: string; value: string } | null>(null);
  const [tested, setTested] = React.useState<Record<string, string>>({});
  const [removing, setRemoving] = React.useState<Endpoint | null>(null);

  const load = React.useCallback(() => {
    api<Endpoint[]>(`v1/super-admin/admins/${tenantId}/webhooks`)
      .then(setRows)
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : (caught as Error).message),
      );
  }, [tenantId]);

  React.useEffect(load, [load]);

  const test = async (endpoint: Endpoint) => {
    setTested((current) => ({ ...current, [endpoint.id]: 'Sending…' }));
    try {
      const result = await api<{ ok: boolean; status: number; error: string | null }>(
        `v1/super-admin/webhooks/${endpoint.id}/test`,
        { method: 'POST' },
      );
      setTested((current) => ({
        ...current,
        [endpoint.id]: result.ok
          ? `Accepted — ${result.status}`
          : `Refused — ${result.error ?? result.status}`,
      }));
      load();
    } catch (caught) {
      setTested((current) => ({
        ...current,
        [endpoint.id]: caught instanceof ApiError ? caught.message : (caught as Error).message,
      }));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Event webhooks"
        subtitle="Where this client's own systems are told what happened, as it happens — the same moments the patient sees in their chat."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" icon={RefreshIcon} onClick={load}>
              Refresh
            </Button>
            <Button size="sm" icon={PlusIcon} onClick={() => setEditing('new')}>
              Add endpoint
            </Button>
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!rows && !error ? <Skeleton className="h-28" /> : null}

      {rows && rows.length === 0 ? (
        <EmptyState
          title="No endpoints yet"
          hint="Add one to start posting visit events to this client's CRM."
        />
      ) : null}

      {rows && rows.length > 0 ? (
        <TableWrap>
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">Sends</th>
              <th scope="col">Health</th>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((endpoint) => (
              <tr key={endpoint.id}>
                <td>
                  <span className="font-medium text-[var(--ar-headings)]">{endpoint.name}</span>
                  <span className="block break-all text-[0.72rem] text-[var(--ar-text-faint)]">
                    {endpoint.url}
                  </span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {endpoint.events.map((event) => (
                      <Badge key={event} tone="info">
                        {WEBHOOK_EVENT_LABEL[event as WebhookEvent] ?? event}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td>
                  <Health endpoint={endpoint} />
                  {tested[endpoint.id] ? (
                    <span className="mt-1 block text-[0.72rem] text-[var(--ar-text-muted)]">
                      {tested[endpoint.id]}
                    </span>
                  ) : null}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={SendIcon}
                      onClick={() => test(endpoint)}
                    >
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={EditIcon}
                      onClick={() => setEditing(endpoint)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={TrashIcon}
                      iconOnly
                      aria-label={`Remove ${endpoint.name}`}
                      onClick={() => setRemoving(endpoint)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : null}

      {editing ? (
        <EndpointDialog
          tenantId={tenantId}
          endpoint={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            if (created) setSecret(created);
            load();
          }}
        />
      ) : null}

      {secret ? <SecretDialog secret={secret} onClose={() => setSecret(null)} /> : null}

      {removing ? (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title={`Remove ${removing.name}?`}
          description="We stop sending to it, and the record of what was sent goes with it."
          tone="danger"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                icon={TrashIcon}
                onClick={async () => {
                  await api(`v1/super-admin/webhooks/${removing.id}`, { method: 'DELETE' });
                  setRemoving(null);
                  load();
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          <p className="break-all text-[0.85rem] text-[var(--ar-text-muted)]">{removing.url}</p>
        </Modal>
      ) : null}
    </Card>
  );
}

/** Whether this endpoint is actually receiving anything. */
function Health({ endpoint }: { endpoint: Endpoint }) {
  if (endpoint.disabled) {
    return (
      <>
        <Badge tone="danger">Switched off</Badge>
        <span className="mt-1 block text-[0.72rem] text-[var(--ar-text-muted)]">
          {endpoint.disabledReason}
        </span>
      </>
    );
  }

  if (!endpoint.isActive) return <Badge tone="neutral">Paused</Badge>;

  if (endpoint.failureCount > 0) {
    return (
      <>
        <Badge tone="warning">
          {endpoint.failureCount} failing
        </Badge>
        <span className="mt-1 block text-[0.72rem] text-[var(--ar-text-muted)]">
          {endpoint.lastError}
        </span>
      </>
    );
  }

  return (
    <>
      <Badge tone="success">Healthy</Badge>
      <span className="mt-1 block text-[0.72rem] text-[var(--ar-text-faint)]">
        {endpoint.lastSuccessAt
          ? `${endpoint.deliveries} sent · last ${formatDateShort(endpoint.lastSuccessAt)}`
          : 'nothing sent yet'}
      </span>
    </>
  );
}

const endpointFormSchema = z.object({
  name: z.string().trim().min(2, 'Give this endpoint a name').max(120),
  url: z.string().trim().min(1, 'Where should we post?').max(500),
  authToken: z.string().trim().max(500),
  events: z.array(z.string()).min(1, 'Choose at least one event to send'),
});
type EndpointForm = z.infer<typeof endpointFormSchema>;

function EndpointDialog({
  tenantId,
  endpoint,
  onClose,
  onSaved,
}: {
  tenantId: string;
  endpoint: Endpoint | null;
  onClose: () => void;
  onSaved: (secret: { name: string; value: string } | null) => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<string[]>(
    endpoint?.events ?? [...WEBHOOK_EVENTS],
  );

  async function submit(values: EndpointForm) {
    setError(null);
    try {
      if (endpoint) {
        await api(`v1/super-admin/webhooks/${endpoint.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            url: values.url,
            events,
            // Left out when blank, so editing the event list does not require
            // re-entering a credential the operator may not have to hand.
            ...(values.authToken ? { authToken: values.authToken } : {}),
          }),
        });
        onSaved(null);
        return;
      }

      const created = await api<{ signingSecret: string; name: string }>(
        `v1/super-admin/admins/${tenantId}/webhooks`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: values.name,
            url: values.url,
            authToken: values.authToken,
            events,
          }),
        },
      );
      onSaved({ name: created.name, value: created.signingSecret });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : (caught as Error).message);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={endpoint ? `Edit ${endpoint.name}` : 'Add an endpoint'}
      description={
        endpoint
          ? 'Leave the token blank to keep the one already stored.'
          : 'We will post each chosen event to this URL as it happens.'
      }
      width="lg"
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Form<EndpointForm>
        schema={endpointFormSchema as never}
        defaultValues={{
          name: endpoint?.name ?? '',
          url: endpoint?.url ?? '',
          authToken: '',
          events,
        }}
        onSubmit={submit as never}
      >
        {(form: { formState: { isSubmitting: boolean } }) => (
          <>
            <TextField<EndpointForm>
              name="name"
              label="Name"
              hint="What this endpoint is for. Two URLs at the same host are otherwise hard to tell apart."
            />
            <TextField<EndpointForm>
              name="url"
              label="URL"
              hint="Must be https. These bodies carry patient information."
              placeholder="https://crm.example.com/hooks/healthemr"
            />
            <PasswordField<EndpointForm>
              name="authToken"
              label={endpoint ? 'Replace bearer token' : 'Bearer token'}
              hint={
                endpoint
                  ? 'Only if it has changed. Blank keeps the stored one.'
                  : 'The token their endpoint expects from us, so it knows the request is ours and not from anyone who guessed the URL.'
              }
            />

            <div>
              <span className="mb-1.5 block text-[0.82rem] font-medium text-[var(--ar-headings)]">
                Events to send
              </span>
              <MultiSelect
                aria-label="Events to send"
                options={EVENT_OPTIONS}
                value={events.join(',')}
                onValueChange={(next) => setEvents(next ? next.split(',').filter(Boolean) : [])}
                placeholder="Choose events"
              />
              {events.length === 0 ? (
                <span className="mt-1 block text-[0.75rem] text-[var(--ar-danger)]">
                  Choose at least one event to send.
                </span>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting || events.length === 0}
              >
                {form.formState.isSubmitting ? 'Saving…' : endpoint ? 'Save' : 'Add endpoint'}
              </Button>
            </div>
          </>
        )}
      </Form>
    </Modal>
  );
}

/**
 * The signing secret, shown once.
 *
 * The client needs it to verify our signature. We keep it to sign with, but
 * there is no reason to serve it back afterwards — and every reason not to.
 */
function SecretDialog({
  secret,
  onClose,
}: {
  secret: { name: string; value: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Send this to the client"
      description={[
        'They verify our signature with it, so they can prove a request came from us and was not altered.',
        'It is shown here once. We cannot display it again.',
      ]}
      footer={<Button onClick={onClose}>I have copied it</Button>}
    >
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-gray-50)] p-3 text-[0.8rem]">
          {secret.value}
        </code>
        <Button
          variant="outline"
          icon={copied ? CheckIcon : CopyIcon}
          onClick={async () => {
            await navigator.clipboard.writeText(secret.value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Modal>
  );
}
