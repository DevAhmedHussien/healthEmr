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
  TableWrap,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { PlusIcon, TrashIcon } from '@/components/ui/icons';
import { formatDateShort } from '@/lib/format';
import { forgetPermissions } from '@/lib/permissions';

interface Grant {
  key: string;
  label: string;
  detail: string;
  group: string;
  /** How much damage it can do: 3 is irreversible or a disclosure. */
  weight: number;
}

interface Preset {
  key: string;
  label: string;
  detail: string;
  permissions: string[];
}

interface Administrator {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'SUPER_ADMIN';
  permissions: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Who administers the platform, and what each of them may do.
 *
 * The grants are shown as a checklist against each person rather than as a set
 * of named roles, because the list is short and the wording is the point: an
 * owner deciding whether somebody may "delete accounts permanently" is making a
 * different decision to granting them "administrator", and a role name hides
 * which one they are making.
 */
export function Team() {
  const [rows, setRows] = React.useState<Administrator[] | null>(null);
  const [grants, setGrants] = React.useState<Grant[]>([]);
  const [groups, setGroups] = React.useState<Array<{ key: string; label: string }>>([]);
  const [presets, setPresets] = React.useState<Preset[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Administrator | null>(null);
  const [removing, setRemoving] = React.useState<Administrator | null>(null);
  const [invite, setInvite] = React.useState<{ email: string; token: string } | null>(null);

  const reload = React.useCallback(async () => {
    setError(null);
    try {
      const [people, permissions] = await Promise.all([
        api<{ data: Administrator[] }>('v1/owner/super-admins'),
        api<{ data: Grant[]; groups: Array<{ key: string; label: string }>; presets: Preset[] }>(
          'v1/owner/permissions',
        ),
      ]);
      setRows(people.data);
      setGrants(permissions.data);
      setGroups(permissions.groups);
      setPresets(permissions.presets);
      // An owner may have just changed their own view of the world.
      forgetPermissions();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not load this.');
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {invite ? (
        <Alert tone="info">
          <span className="block font-medium">Invitation for {invite.email}</span>
          <span className="mt-1 block text-[0.88rem]">
            Email delivery is not connected yet, so send them this link yourself. It is shown once.
          </span>
          <code className="mt-2 block overflow-x-auto rounded-[var(--ar-radius)] bg-[var(--ar-gray-50)] p-2 text-[0.78rem]">
            {typeof window !== 'undefined' ? window.location.origin : ''}/accept-invite?token=
            {invite.token}
          </code>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Administrators"
          subtitle="Owners hold every permission. Super admins hold the ones you give them, and a change takes effect immediately."
          action={
            <Button size="sm" icon={PlusIcon} onClick={() => setAdding(true)}>
              Add a super admin
            </Button>
          }
        />

        {!rows ? (
          <div className="ar-skeleton h-40" />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Permissions</th>
                <th>Last signed in</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => (
                <tr key={person.id}>
                  <td>
                    <span className="font-medium">{person.name}</span>
                    <span className="block text-[0.8rem] text-[var(--ar-text-muted)]">
                      {person.email}
                    </span>
                  </td>
                  <td>
                    <Badge tone={person.role === 'OWNER' ? 'info' : 'neutral'}>
                      {person.role === 'OWNER' ? 'owner' : 'super admin'}
                    </Badge>
                    {!person.isActive ? (
                      <Badge tone="warning">
                        <span className="ml-1">suspended</span>
                      </Badge>
                    ) : null}
                  </td>
                  <td>
                    {person.role === 'OWNER' ? (
                      <span className="text-[0.85rem] text-[var(--ar-text-muted)]">
                        Everything, by virtue of the role
                      </span>
                    ) : person.permissions.length === 0 ? (
                      <span className="text-[0.85rem] text-[var(--ar-text-muted)]">
                        Read-only
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {person.permissions.map((key) => (
                          <Badge key={key} tone="neutral">
                            {grants.find((grant) => grant.key === key)?.label ?? key}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {person.lastLoginAt ? formatDateShort(person.lastLoginAt) : 'never'}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      {person.role === 'OWNER' ? (
                        // Not editable from here by anyone, including another
                        // owner: a screen that lets one owner strip another is a
                        // screen that lets a stolen session take the platform.
                        <span className="text-[0.82rem] text-[var(--ar-text-faint)]">—</span>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing(person)}>
                            Permissions
                          </Button>
                          <button
                            type="button"
                            aria-label={`Remove ${person.name}`}
                            title={`Remove ${person.name}`}
                            onClick={() => setRemoving(person)}
                            className="grid h-7 w-7 place-items-center rounded-[var(--ar-radius)] text-[var(--ar-text-muted)] transition hover:bg-[var(--ar-danger-soft)] hover:text-[var(--ar-on-danger)]"
                          >
                            <TrashIcon size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {adding ? (
        <AddDialog
          grants={grants}
          groups={groups}
          presets={presets}
          onClose={() => setAdding(false)}
          onAdded={(result) => {
            setInvite(result);
            setAdding(false);
            void reload();
          }}
        />
      ) : null}

      {editing ? (
        <PermissionsDialog
          person={editing}
          grants={grants}
          groups={groups}
          presets={presets}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : null}

      {removing ? (
        <RemoveDialog
          person={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The checklist.
 *
 * Grouped by area and led by presets, because twelve tickboxes presented flat
 * is a form people click through rather than read. The presets are real jobs —
 * operations does not need to see margin, finance does not need to open a
 * chart — so most of the time an owner picks one and adjusts a single line.
 */
function GrantList({
  grants,
  groups,
  presets,
  chosen,
  onChange,
}: {
  grants: Grant[];
  groups: Array<{ key: string; label: string }>;
  presets: Preset[];
  chosen: string[];
  onChange: (next: string[]) => void;
}) {
  const matchingPreset = presets.find(
    (preset) =>
      preset.permissions.length === chosen.length &&
      preset.permissions.every((key) => chosen.includes(key)),
  );

  return (
    <div className="space-y-5">
      {presets.length ? (
        <div>
          <p className="mb-2 text-[0.82rem] font-medium uppercase tracking-wide text-[var(--ar-text-faint)]">
            Start from
          </p>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => {
              const active = matchingPreset?.key === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  title={preset.detail}
                  onClick={() => onChange([...preset.permissions])}
                  className={
                    active
                      ? 'rounded-full bg-[var(--ar-primary)] px-3.5 py-1.5 text-[0.84rem] font-medium text-white'
                      : 'rounded-full border border-[var(--ar-border)] px-3.5 py-1.5 text-[0.84rem] text-[var(--ar-text-muted)] transition hover:border-[var(--ar-text-muted)]'
                  }
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {groups.map((group) => {
        const inGroup = grants.filter((grant) => grant.group === group.key);
        if (!inGroup.length) return null;
        const on = inGroup.filter((grant) => chosen.includes(grant.key)).length;
        return (
          <div key={group.key}>
            <p className="mb-2 flex items-baseline gap-2 text-[0.82rem] font-medium uppercase tracking-wide text-[var(--ar-text-faint)]">
              {group.label}
              <span className="tabular-nums normal-case tracking-normal">
                {on}/{inGroup.length}
              </span>
            </p>
            <div className="space-y-2">
              {inGroup.map((grant) => {
                const ticked = chosen.includes(grant.key);
                return (
                  <label
                    key={grant.key}
                    className={[
                      'flex cursor-pointer items-start gap-3 rounded-[var(--ar-radius)] border p-3 transition',
                      ticked
                        ? 'border-[var(--ar-primary)] bg-[var(--ar-primary-soft)]'
                        : 'border-[var(--ar-border)] hover:border-[var(--ar-text-muted)]',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() =>
                        onChange(
                          ticked
                            ? chosen.filter((key) => key !== grant.key)
                            : [...chosen, grant.key],
                        )
                      }
                      className="mt-1 h-4 w-4 accent-[var(--ar-primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.92rem] font-medium">{grant.label}</span>
                        {/* Marked, not hidden: the ones that cannot be undone
                            deserve a second of attention before the tick. */}
                        {grant.weight >= 3 ? (
                          <Badge tone="warning">high impact</Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[0.84rem] text-[var(--ar-text-muted)]">
                        {grant.detail}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What this change actually does, in plain words, before it is saved. */
function ChangeSummary({
  grants,
  before,
  after,
}: {
  grants: Grant[];
  before: string[];
  after: string[];
}) {
  const name = (key: string) => grants.find((grant) => grant.key === key)?.label ?? key;
  const added = after.filter((key) => !before.includes(key));
  const removed = before.filter((key) => !after.includes(key));

  if (!added.length && !removed.length) {
    return (
      <p className="text-[0.86rem] text-[var(--ar-text-muted)]">Nothing has changed yet.</p>
    );
  }

  return (
    <div className="space-y-1.5 text-[0.86rem]">
      {added.length ? (
        <p>
          <span className="font-medium text-[var(--ar-on-success)]">Granting:</span>{' '}
          {added.map(name).join(', ')}
        </p>
      ) : null}
      {removed.length ? (
        <p>
          <span className="font-medium text-[var(--ar-on-danger)]">Removing:</span>{' '}
          {removed.map(name).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

function AddDialog({
  grants,
  groups,
  presets,
  onClose,
  onAdded,
}: {
  grants: Grant[];
  groups: Array<{ key: string; label: string }>;
  presets: Preset[];
  onClose: () => void;
  onAdded: (invite: { email: string; token: string }) => void;
}) {
  const [form, setForm] = React.useState({ email: '', firstName: '', lastName: '' });
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ready = form.email.includes('@') && form.firstName.trim() && form.lastName.trim();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ email: string; inviteToken: string }>('v1/owner/super-admins', {
        method: 'POST',
        body: JSON.stringify({ ...form, permissions: chosen }),
      });
      onAdded({ email: created.email, token: created.inviteToken });
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
      title="Add a super admin"
      description="They receive an invitation to set their own password. You never set it for them, and the account cannot be used until they do."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ready || busy}>
            {busy ? 'Adding…' : 'Add and invite'}
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
        <Field label="First name">
          <Input
            value={form.firstName}
            onChange={(event) => setForm({ ...form, firstName: event.target.value })}
          />
        </Field>
        <Field label="Last name">
          <Input
            value={form.lastName}
            onChange={(event) => setForm({ ...form, lastName: event.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[0.92rem] font-medium">What they may do</p>
        <p className="mb-3 text-[0.84rem] text-[var(--ar-text-muted)]">
          Leave everything unticked for read-only. You can change this at any time.
        </p>
        <GrantList
          grants={grants}
          groups={groups}
          presets={presets}
          chosen={chosen}
          onChange={setChosen}
        />
      </div>
    </Modal>
  );
}

function PermissionsDialog({
  person,
  grants,
  groups,
  presets,
  onClose,
  onSaved,
}: {
  person: Administrator;
  grants: Grant[];
  groups: Array<{ key: string; label: string }>;
  presets: Preset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [chosen, setChosen] = React.useState<string[]>(person.permissions);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const changed =
    chosen.length !== person.permissions.length ||
    chosen.some((key) => !person.permissions.includes(key));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`v1/owner/super-admins/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          permissions: chosen,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
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
      title={`What ${person.name} may do`}
      description="Changes apply at once — a permission you remove stops working immediately, without waiting for them to sign out."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!changed || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <GrantList
        grants={grants}
        groups={groups}
        presets={presets}
        chosen={chosen}
        onChange={setChosen}
      />

      {/* Said back before it is saved. A checklist shows the destination; this
          shows the journey, which is what an owner is actually approving. */}
      <div className="mt-5 rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-gray-50)] p-3">
        <ChangeSummary grants={grants} before={person.permissions} after={chosen} />
      </div>

      <div className="mt-4">
        <Field label="Why (optional)" hint="Recorded with the change.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. taking over the pharmacy onboarding"
          />
        </Field>
      </div>
    </Modal>
  );
}

function RemoveDialog({
  person,
  onClose,
  onRemoved,
}: {
  person: Administrator;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`v1/owner/super-admins/${person.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onRemoved();
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
      title={`Remove ${person.name}?`}
      description="Their account is erased and they lose access immediately. Everything they did stays attributed to them in the audit log."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} disabled={busy || reason.trim().length < 10}>
            {busy ? 'Removing…' : 'Remove permanently'}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <Field
        label="Why"
        hint="Required, and recorded permanently. This is the account of why somebody with access to every patient no longer has it."
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. left the company on 30 September"
          autoFocus
        />
      </Field>
    </Modal>
  );
}
