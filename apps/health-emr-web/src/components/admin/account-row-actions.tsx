'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { RowActions, type RowAction } from '@/components/table/row-actions';
import { useRowMutation } from '@/components/table/data-table';
import { usePermissions } from '@/lib/permissions';

export type AccountKind = 'tenant' | 'provider' | 'pharmacy';

/** What the endpoints call each kind, and what a person calls it. */
const KIND = {
  tenant: { path: 'admins', noun: 'client account' },
  provider: { path: 'providers', noun: 'clinician' },
  pharmacy: { path: 'pharmacies', noun: 'pharmacy' },
} as const;

interface Blocker {
  count: number;
  what: string;
}

interface StaffAccount {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  archivedAt: string | null;
}

interface DeletionReport {
  deletable: boolean;
  /** Only staff are in the way, and this administrator may take them. */
  deletableByOwner: boolean;
  /** Records of care or of money. Nobody's grant moves these. */
  hardBlockers: Blocker[];
  staffBlockers: Blocker[];
  blockers: Blocker[];
  staffAccounts: StaffAccount[];
  /** The API's own words for what to do instead. */
  alternative: string | null;
  /** What has to be typed to confirm — a slug, never a display name. */
  confirmPhrase: string | null;
}

/**
 * Archive, restore and erase, from the row itself.
 *
 * These used to live only on the detail page, which meant tidying up five
 * mistaken accounts was five round trips. The icons and their order come from
 * the shared row-actions component, so this column reads the same as every
 * other one; what is specific to an account is the dialog below.
 */
export function AccountRowActions({
  kind,
  id,
  name,
  archived,
}: {
  kind: AccountKind;
  id: string;
  name: string;
  archived: boolean;
}) {
  const { can, loading } = usePermissions();
  const [open, setOpen] = React.useState<null | 'archive' | 'restore' | 'delete'>(null);

  // While the grants are still loading, show nothing rather than flashing
  // buttons that may be about to disappear.
  if (loading) return <span className="block h-7" />;

  const mayArchive = can('ACCOUNTS_ARCHIVE');
  const mayDelete = can('ACCOUNTS_DELETE');

  const actions: RowAction[] = [
    {
      kind: archived ? 'restore' : 'archive',
      label: `${archived ? 'Restore' : 'Archive'} ${name}`,
      permitted: mayArchive,
      onSelect: () => setOpen(archived ? 'restore' : 'archive'),
    },
    {
      kind: 'delete',
      label: `Delete ${name} permanently`,
      permitted: mayDelete,
      onSelect: () => setOpen('delete'),
    },
  ];

  return (
    <>
      <RowActions actions={actions} />
      {open ? (
        <ConfirmDialog
          kind={kind}
          id={id}
          name={name}
          action={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/**
 * The confirmation.
 *
 * Deleting asks the endpoint first what it would destroy, so the dialog can
 * say "this has 31 visits" *before* the button is pressed rather than turning
 * the press into an error. Archiving does not need that — it is reversible,
 * and a dialog that interrogates the database to confirm something undoable is
 * ceremony rather than safety.
 *
 * What the refusal says comes entirely from the answer. It used to end with a
 * fixed sentence about health records being kept for years, which was true of
 * a tenant with visits and nonsense for one whose only blocker was a login
 * nobody had ever signed into — the stated reason and the actual reason were
 * different things, which is a worse failure than saying nothing.
 */
function ConfirmDialog({
  kind,
  id,
  name,
  action,
  onClose,
}: {
  kind: AccountKind;
  id: string;
  name: string;
  action: 'archive' | 'restore' | 'delete';
  onClose: () => void;
}) {
  const router = useRouter();
  const mutation = useRowMutation();
  const [reason, setReason] = React.useState('');
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<DeletionReport | null>(null);
  const [checking, setChecking] = React.useState(action === 'delete');

  React.useEffect(() => {
    if (action !== 'delete') return;
    let live = true;
    api<DeletionReport>(`v1/super-admin/permanent-delete/${kind}/${id}`)
      .then((result) => live && setReport(result))
      .catch(() => live && setError('We could not check what this would affect.'))
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [action, kind, id]);

  const noun = KIND[kind].noun;
  const hard = report?.hardBlockers ?? [];
  const staff = report?.staffAccounts ?? [];

  /** Nothing anybody can do from here. */
  const blocked = action === 'delete' && hard.length > 0;
  /** In the way, but this administrator may agree to take it. */
  const resolvable = action === 'delete' && !blocked && Boolean(report?.deletableByOwner);

  const phrase = report?.confirmPhrase ?? null;
  const needsReason = action !== 'restore';
  // Typing the slug is asked for only when logins are about to go with the
  // account. A delete with nothing attached is already behind a reason and a
  // red button, and ceremony that is always there stops being read.
  const needsPhrase = resolvable && Boolean(phrase);

  const ready =
    !busy &&
    !checking &&
    !blocked &&
    (!needsReason || reason.trim().length >= 10) &&
    (!needsPhrase || typed.trim() === phrase);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (action === 'delete') {
        await api(`v1/super-admin/permanent-delete/${kind}/${id}`, {
          method: 'DELETE',
          body: JSON.stringify({
            reason: reason.trim(),
            // Sent only when the dialog actually showed which logins would go.
            ...(resolvable ? { removeStaffAccounts: true } : {}),
          }),
        });
      } else if (action === 'archive') {
        await api(`v1/super-admin/${KIND[kind].path}/${id}`, {
          method: 'DELETE',
          body: JSON.stringify({ reason: reason.trim() }),
        });
      } else {
        await api(`v1/super-admin/${KIND[kind].path}/${id}/restore`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Restored' }),
        });
      }
      onClose();

      // The table fetches its own rows, so it has to be told. A deleted row
      // goes now and the server is asked for the rest afterwards; an archived
      // one stays put with a different badge, so there is nothing to remove
      // and only the reconcile is wanted.
      if (action === 'delete') mutation?.drop(id);
      else mutation?.refresh();

      // And the page around it — headline counts and anything else rendered
      // on the server — which is all `router.refresh()` was ever doing here.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const copy = {
    archive: {
      title: `Archive ${name}?`,
      lead: `This ${noun} stops being used. Nothing is deleted, and you can put it back at any time.`,
      confirm: 'Archive',
    },
    restore: {
      title: `Restore ${name}?`,
      lead: `This ${noun} goes back into use exactly as it was.`,
      confirm: 'Restore',
    },
    delete: {
      title: `Permanently delete ${name}?`,
      lead: `This erases the ${noun} completely. It cannot be undone, and it is not the same as archiving.`,
      confirm: resolvable ? 'Delete account and logins' : 'Delete permanently',
    },
  }[action];

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      description={copy.lead}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={action === 'delete' ? 'danger' : 'primary'}
            onClick={run}
            disabled={!ready}
          >
            {busy ? 'Working…' : copy.confirm}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {action === 'delete' && checking ? (
        <p className="text-[0.9rem] text-[var(--ar-text-muted)]">Checking what refers to this…</p>
      ) : null}

      {blocked ? (
        <Alert tone="danger">
          <span className="block font-medium">This cannot be deleted.</span>
          <span className="mt-1 block">
            {listBlockers(hard)} {hard.length === 1 && hard[0].count === 1 ? 'refers' : 'refer'} to
            it.{report?.alternative ? ` ${report.alternative}` : ''}
          </span>
        </Alert>
      ) : null}

      {resolvable ? (
        <Alert tone="warning">
          <span className="block font-medium">
            {staff.length === 1
              ? 'One staff account will be deleted with it.'
              : `${staff.length} staff accounts will be deleted with them.`}
          </span>
          <span className="mt-1 block">
            Nothing clinical refers to this {noun}, so it can go. These logins go with it and
            cannot be restored.
          </span>
          <ul className="mt-3 space-y-1.5">
            {staff.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center gap-2 text-[0.85rem]">
                <span className="font-medium">{account.email}</span>
                <Badge tone="neutral">{account.role.toLowerCase().replace('_', ' ')}</Badge>
                {account.isActive ? (
                  // The one that deserves a second look: somebody may be using
                  // this to sign in today.
                  <Badge tone="warning">active — someone may be using this</Badge>
                ) : (
                  <Badge tone="neutral">inactive</Badge>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {!blocked && needsReason ? (
        <div className="mt-4">
          <Field
            label="Why"
            hint={
              action === 'delete'
                ? 'Required, and recorded permanently. This is the only account of why the record no longer exists.'
                : 'Recorded with the change.'
            }
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                action === 'delete' ? 'e.g. created in error during setup' : 'e.g. contract ended'
              }
              autoFocus
            />
          </Field>
        </div>
      ) : null}

      {needsPhrase ? (
        <div className="mt-4">
          <Field
            label={`Type ${phrase} to confirm`}
            hint="The account's slug, not its display name — two clients can read alike on screen."
          >
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={phrase ?? ''}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

/** "2 visits, 1 invoice" — the numbers are what make a refusal persuasive. */
function listBlockers(blockers: Blocker[]): string {
  return blockers.map((blocker) => `${blocker.count} ${blocker.what}`).join(', ');
}
