'use client';

import * as React from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Skeleton,
  TableWrap,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Copyable } from '@/components/ui/copyable';
import { DateField } from '@/components/ui/date-field';
import { Form } from '@/components/form/form';
import { TextField } from '@/components/form/fields';
import { Tooltip } from '@/components/ui/tooltip';
import { KeyIcon, PlusIcon, RefreshIcon, TrashIcon } from '@/components/ui/icons';
import { formatDateShort } from '@/lib/format';

/**
 * How long ago, in words, or null if it has never been used.
 *
 * Withdrawing a key is irreversible and the thing you most need to know before
 * doing it is whether something is currently running on it. A date in a table
 * cell does not carry that; "used 3 minutes ago" does.
 */
function lastUsed(value: string | null): string | null {
  if (!value) return null;
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'seconds ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Recently enough that something is probably still running on it. */
const IN_USE_WINDOW_HOURS = 48;

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

interface Access {
  tenant: { id: string; slug: string; name: string; status: string };
  companyKey: string;
  baseUrl: string;
  keys: ApiKey[];
}

const TONE = { ACTIVE: 'success', EXPIRED: 'warning', REVOKED: 'neutral' } as const;

/**
 * The two values a telehealth business needs from us, and the keys behind them.
 *
 * They are shown together because they only work together: the bearer token
 * says which account is calling, and the company key in the payload says which
 * account the caller claims to be. Intake refuses a visit whose two disagree,
 * so a submission that gets through is attributable to one account by
 * construction rather than by trust.
 *
 * Used by the platform console against any client, and by a client against
 * itself — the same panel, a different base path, because rotating a credential
 * is routine and should not need us.
 */
export function ApiAccessPanel({
  base,
  title = 'API access',
  canIssue = true,
}: {
  /** `v1/admin`, or `v1/super-admin/admins/<id>`. */
  base: string;
  /** Overridden where the page heading already says "API access". */
  title?: string;
  canIssue?: boolean;
}) {
  const [access, setAccess] = React.useState<Access | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [issuing, setIssuing] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ApiKey | null>(null);
  const [replacing, setReplacing] = React.useState<ApiKey | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** Held in state for exactly as long as the dialog is open. Never stored. */
  const [issued, setIssued] = React.useState<{
    key: string;
    name: string;
    replaced?: boolean;
  } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setAccess(await api<Access>(`${base}/api-access`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load API access');
    }
  }, [base]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`${base}/api-keys/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not delete that key');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Rotates a key: issue the replacement, then delete the one it replaces.
   *
   * In that order, and not the other way round. Deleting first would leave the
   * account with no working credential for as long as the second call takes,
   * and if that call fails, permanently. This way the worst case is two live
   * keys, which is a tidy-up rather than an outage.
   */
  async function replace() {
    if (!replacing) return;
    setBusy(true);
    try {
      const issuedKey = await api<{ key: string }>(`${base}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({
          name: replacing.name,
          ...(replacing.expiresAt ? { expiresAt: replacing.expiresAt } : {}),
        }),
      });

      await api(`${base}/api-keys/${replacing.id}`, { method: 'DELETE' });

      setIssued({ key: issuedKey.key, name: replacing.name, replaced: true });
      setReplacing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not replace that key');
    } finally {
      setBusy(false);
    }
  }

  if (error && !access) return <Alert tone="danger">{error}</Alert>;
  if (!access) return <Skeleton className="h-64" />;

  const live = access.keys.filter((key) => key.status === 'ACTIVE').length;

  return (
    <div className="grid gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card className="p-0">
        <div className="p-6 pb-4">
          <CardHeader
            title={title}
            subtitle={
              `Everything ${access.tenant.name} needs to post visits to us. Both values below go on ` +
              `every request — the token in the header, the company key in the body — and a visit ` +
              `whose two disagree is refused.`
            }
            action={
              canIssue ? (
                <Button
                  size="sm"
                  icon={PlusIcon}
                  className="whitespace-nowrap"
                  onClick={() => setIssuing(true)}
                >
                  Issue a key
                </Button>
              ) : null
            }
          />
        </div>

        <div className="grid gap-4 border-t border-[var(--ar-border-soft)] p-6">
          <Field
            label="Company key"
            hint="Send as `company` on every visit. Not a secret — it names the account, it does not prove it."
          >
            <Copyable value={access.companyKey} label="company key" />
          </Field>
          <Field label="Base URL" hint="Visits are posted to /partner/v1/visit/createNoPayPhotos.">
            <Copyable value={access.baseUrl} label="base URL" mono={false} />
          </Field>
          <Field
            label="A request, ready to send"
            hint="Paste your key where it says so. This is the whole integration."
          >
            <Copyable
              value={
                `curl -X POST ${access.baseUrl}/partner/v1/visit/createNoPayPhotos \\\n` +
                `  -H "Authorization: Bearer <your key>" \\\n` +
                `  -H "Content-Type: application/json" \\\n` +
                `  -d '{"company":"${access.companyKey}","visitType":"weightloss",` +
                `"pharmacyId":"<pharmacy>","masterId":"<your order id>","formObj":{...}}'`
              }
              label="example request"
            />
          </Field>
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-6 pb-3">
          <CardHeader
            title="Keys"
            subtitle={
              canIssue
                ? live === 0
                  ? 'No key is live, so nothing can post a visit to this account yet.'
                  : `${live} live. A key is shown once when it is issued and cannot be shown again — if one is lost, issue a replacement and delete the old one.`
                : `${live} live. Keys are issued and removed by the platform owner; ask us for a new one, or to remove one you have stopped using.`
            }
          />
        </div>

        {access.keys.length === 0 ? (
          <EmptyState
            title="No keys yet"
            hint={
              canIssue
                ? 'Issue one to let this business start sending visits.'
                : 'Nothing can post a visit to your account yet. Ask us to issue one.'
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Status</th>
                <th scope="col">Issued</th>
                <th scope="col">Last used</th>
                <th scope="col">Expires</th>
                {canIssue ? <th scope="col"></th> : null}
              </tr>
            </thead>
            <tbody>
              {access.keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <span className="font-medium text-[var(--ar-headings)]">{key.name}</span>
                  </td>
                  <td className="font-mono text-[0.8rem]">hemr_{key.keyPrefix}…</td>
                  <td>
                    <Badge tone={TONE[key.status]}>{key.status.toLowerCase()}</Badge>
                  </td>
                  <td className="tabular-nums">{formatDateShort(key.createdAt)}</td>
                  <td className="tabular-nums">
                    {key.lastUsedAt ? (
                      <Tooltip content={formatDateShort(key.lastUsedAt)}>
                        {lastUsed(key.lastUsedAt)}
                      </Tooltip>
                    ) : (
                      // Worth naming. A key that has never been used is either
                      // an integration that was never finished or one nobody
                      // dares withdraw.
                      <span className="text-[var(--ar-text-faint)]">never used</span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {key.expiresAt ? (
                      formatDateShort(key.expiresAt)
                    ) : (
                      <span className="text-[var(--ar-text-faint)]">—</span>
                    )}
                  </td>
                  {canIssue ? (
                    <td>
                      <div className="flex justify-end gap-1">
                        {/* The answer to "I have lost this key". The key itself
                            cannot be shown again — only its hash is stored —
                            so rotating it is the way to get one you can copy. */}
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon={RefreshIcon}
                          aria-label={`Replace ${key.name}`}
                          onClick={() => setReplacing(key)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon={TrashIcon}
                          aria-label={`Delete ${key.name}`}
                          onClick={() => setDeleting(key)}
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {issuing ? (
        <IssueDialog
          base={base}
          onClose={() => setIssuing(false)}
          onIssued={async (key, name) => {
            setIssuing(false);
            setIssued({ key, name });
            await load();
          }}
        />
      ) : null}

      {issued ? (
        <Modal
          open
          title="Copy this key now"
          description={[
            `This is the only time “${issued.name}” will ever be shown. We store a hash of it, not the key, so it cannot be looked up or resent.`,
            issued.replaced
              ? 'The key it replaces stopped working just now — paste this one wherever that was in use.'
              : 'If it is lost, use Replace on its row to rotate it and get one you can copy.',
          ]}
          onClose={() => setIssued(null)}
          footer={
            <Button onClick={() => setIssued(null)} icon={KeyIcon}>
              I have copied it
            </Button>
          }
        >
          <div className="grid gap-4">
            <Copyable value={issued.key} label="API key" tone="secret" />
            <Field label="Company key" hint="Goes in the body of every visit, alongside the token.">
              <Copyable value={access.companyKey} label="company key" />
            </Field>
          </div>
        </Modal>
      ) : null}

      {replacing ? (
        <ConfirmDialog
          open
          title={`Replace “${replacing.name}”?`}
          body={
            `A new key is issued under the same name and shown to you once. “${replacing.name}” is ` +
            `deleted at the same moment, so anything still sending the old one starts getting 401.`
          }
          consequence={
            replacing.lastUsedAt ? (
              <span className="font-medium">
                This key was used {lastUsed(replacing.lastUsedAt)}. Have somewhere ready to paste
                the new one before you continue — whatever is running on it stops the moment you do.
              </span>
            ) : (
              'This key has never been used, so nothing will break.'
            )
          }
          confirmLabel="Replace"
          busy={busy}
          onClose={() => setReplacing(null)}
          onConfirm={replace}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete “${deleting.name}”?`}
          body={
            `The key is removed from this account and from the database, and stops working ` +
            `immediately. Anything still sending it gets 401 on its next request. It cannot be ` +
            `brought back — issue a new one instead.`
          }
          consequence={
            // The one fact that decides whether this is safe. A key used
            // minutes ago is a live integration, and withdrawing it takes
            // something down — quite possibly a patient-facing form.
            deleting.lastUsedAt &&
            Date.now() - new Date(deleting.lastUsedAt).getTime() <
              IN_USE_WINDOW_HOURS * 3600_000 ? (
              <span className="font-medium text-[var(--ar-danger)]">
                This key was used {lastUsed(deleting.lastUsedAt)}. Something is running on it right
                now. Issue its replacement and switch over before withdrawing this one.
              </span>
            ) : deleting.lastUsedAt ? (
              `Last used ${lastUsed(deleting.lastUsedAt)}.`
            ) : (
              'This key has never been used, so nothing can be relying on it.'
            )
          }
          confirmLabel="Delete"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}

/**
 * The form's own shape.
 *
 * A date input speaks `YYYY-MM-DD`; the API wants an instant. The mapping is
 * declared here rather than done by hand at submit time, so the value the
 * resolver validates is the value that gets sent — the two cannot drift.
 */
const issueFormSchema = z.object({
  name: z.string().trim().min(2, 'Give the key a name so you can tell it apart later').max(120),
  expiresOn: z.string().trim().optional(),
});

type IssueFormValues = z.infer<typeof issueFormSchema>;

function IssueDialog({
  base,
  onClose,
  onIssued,
}: {
  base: string;
  onClose: () => void;
  onIssued: (key: string, name: string) => void | Promise<void>;
}) {
  const [error, setError] = React.useState<string | null>(null);

  async function submit(values: IssueFormValues) {
    setError(null);
    try {
      const result = await api<{ key: string }>(`${base}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          // End of that day in the reader's own zone, so "expires on the 30th"
          // is still valid on the 30th.
          ...(values.expiresOn
            ? { expiresAt: new Date(`${values.expiresOn}T23:59:59`).toISOString() }
            : {}),
        }),
      });
      await onIssued(result.key, values.name);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not issue that key');
    }
  }

  return (
    <Form<IssueFormValues>
      id="issue-api-key"
      schema={issueFormSchema}
      defaultValues={{ name: '', expiresOn: '' }}
      onSubmit={submit}
      className="contents"
    >
      {(form) => (
        <Modal
          open
          title="Issue an API key"
          description="The key is returned once and never again. Have somewhere to paste it before you continue."
          onClose={onClose}
          footer={
            <>
              <Button variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>
                Cancel
              </Button>
              {/* The dialog portals its footer to the document body, so the
                  button is not a descendant of the form element. Calling
                  `handleSubmit` directly is more honest than relying on the
                  `form=` attribute to reach across the portal. */}
              <Button
                type="button"
                onClick={form.handleSubmit(submit)}
                disabled={form.formState.isSubmitting}
                icon={KeyIcon}
              >
                {form.formState.isSubmitting ? 'Issuing…' : 'Issue key'}
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            {error ? <Alert tone="danger">{error}</Alert> : null}

            <TextField<IssueFormValues>
              name="name"
              label="What is it for"
              required
              placeholder="production backend"
              hint="You cannot see the key again, so this name is how you tell one from another."
            />

            <Controller
              control={form.control}
              name="expiresOn"
              render={({ field }) => (
                <Field
                  label="Expires"
                  hint="Optional. Leave blank for a key that works until it is withdrawn."
                >
                  <DateField
                    value={field.value ?? ''}
                    label="Expires"
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
        </Modal>
      )}
    </Form>
  );
}
