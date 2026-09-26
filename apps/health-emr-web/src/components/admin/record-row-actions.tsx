'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { RowActions, type RowAction } from '@/components/table/row-actions';
import { useRowMutation } from '@/components/table/data-table';
import { usePermissions } from '@/lib/permissions';

export type RecordKind = 'visit' | 'prescription';

interface RecordReport {
  kind: RecordKind;
  /** The master id — what is on screen, so it can be checked by eye. */
  confirmPhrase: string | null;
  finalised: boolean;
  deletable: boolean;
  /** Why it cannot be erased, in words meant for a disabled button. */
  reason: string | null;
  archived: boolean;
  alternative: string | null;
}

const NOUN: Record<RecordKind, string> = { visit: 'visit', prescription: 'prescription' };

/**
 * Withdraw, restore and erase, on a visit or a prescription.
 *
 * The delete icon is nearly always disabled here, and that is the honest
 * state rather than a defect: a visit a clinician decided and every signed
 * prescription is retained, so what the button offers is the reason. Hiding it
 * instead would leave an administrator hunting for a control that does not
 * exist, and asking somebody else where it went.
 *
 * The reason comes from the API. This component does not know what makes a
 * record final, and should not — the rule lives with the records and would
 * drift the moment it were restated here.
 */
export function RecordRowActions({
  kind,
  id,
  label,
  archived,
}: {
  kind: RecordKind;
  id: string;
  /** The master id or equivalent, for the dialog's title. */
  label: string;
  archived: boolean;
}) {
  const { can, loading } = usePermissions();
  const [open, setOpen] = React.useState<null | 'archive' | 'restore' | 'delete'>(null);
  const [report, setReport] = React.useState<RecordReport | null>(null);

  const mayDelete = can('RECORDS_DELETE');

  // Asked once per row, and only for somebody who could act on the answer.
  React.useEffect(() => {
    if (!mayDelete || loading) return;
    let live = true;
    api<RecordReport>(`v1/super-admin/records/${kind}/${id}/deletion`)
      .then((result) => live && setReport(result))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [mayDelete, loading, kind, id]);

  if (loading) return <span className="block h-7" />;

  const actions: RowAction[] = [
    {
      kind: archived ? 'restore' : 'archive',
      label: archived ? `Restore ${label}` : `Withdraw ${label}`,
      permitted: mayDelete,
      onSelect: () => setOpen(archived ? 'restore' : 'archive'),
    },
    {
      kind: 'delete',
      label: `Erase ${label} permanently`,
      permitted: mayDelete,
      // Until the answer arrives, the safe assumption is that it cannot go.
      blockedReason: report
        ? report.deletable
          ? null
          : report.reason
        : 'checking what this would affect…',
      onSelect: () => setOpen('delete'),
    },
  ];

  return (
    <>
      <RowActions actions={actions} />
      {open ? (
        <RecordDialog
          kind={kind}
          id={id}
          label={label}
          action={open}
          report={report}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function RecordDialog({
  kind,
  id,
  label,
  action,
  report,
  onClose,
}: {
  kind: RecordKind;
  id: string;
  label: string;
  action: 'archive' | 'restore' | 'delete';
  report: RecordReport | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const mutation = useRowMutation();
  const [reason, setReason] = React.useState('');
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const noun = NOUN[kind];
  const blocked = action === 'delete' && report !== null && !report.deletable;
  const phrase = report?.confirmPhrase ?? null;
  const needsPhrase = action === 'delete' && !blocked && Boolean(phrase);
  const needsReason = action !== 'restore';

  const ready =
    !busy &&
    !blocked &&
    (!needsReason || reason.trim().length >= 10) &&
    (!needsPhrase || typed.trim() === phrase);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (action === 'delete') {
        await api(`v1/super-admin/records/visit/${id}`, {
          method: 'DELETE',
          body: JSON.stringify({ reason: reason.trim() }),
        });
      } else if (action === 'archive') {
        // A visit is withdrawn through its own endpoint; a prescription
        // through the records one. Both mean the same thing to the reader.
        const path =
          kind === 'visit'
            ? `v1/super-admin/visits/${id}`
            : `v1/super-admin/records/prescription/${id}`;
        await api(path, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
      } else {
        const path =
          kind === 'visit'
            ? `v1/super-admin/visits/${id}/restore`
            : `v1/super-admin/records/prescription/${id}/restore`;
        await api(path, { method: 'POST' });
      }
      onClose();

      // Erasing takes the row off now. Withdrawing leaves it in place with a
      // withdrawn badge, so the table is only asked to reconcile — unless the
      // list it is in hides withdrawn records, in which case the reconcile is
      // what removes it, and correctly so.
      if (action === 'delete') mutation?.drop(id);
      else mutation?.refresh();

      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const copy = {
    archive: {
      title: `Withdraw ${label}?`,
      lead: `This ${noun} is marked as entered in error and stops appearing in the lists. Nothing is deleted, and it can be put back.`,
      confirm: 'Withdraw',
    },
    restore: {
      title: `Restore ${label}?`,
      lead: `This ${noun} goes back into the lists exactly as it was.`,
      confirm: 'Restore',
    },
    delete: {
      title: `Permanently erase ${label}?`,
      lead: `This removes the ${noun} and its intake answers for good. It cannot be undone.`,
      confirm: 'Erase permanently',
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

      {blocked ? (
        <Alert tone="danger">
          <span className="block font-medium">This cannot be erased.</span>
          <span className="mt-1 block">
            {report?.reason ? `It stays because ${report.reason}.` : ''}
            {report?.alternative ? ` ${report.alternative}` : ''}
          </span>
        </Alert>
      ) : null}

      {!blocked && needsReason ? (
        <div className="mt-4">
          <Field
            label="Why"
            hint={
              action === 'delete'
                ? 'Required, and recorded permanently. This is the only account of why the record no longer exists.'
                : 'Required, and shown on the record. Somebody will read this years from now.'
            }
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                action === 'delete'
                  ? 'e.g. posted twice by the client’s server'
                  : 'e.g. wrong strength entered at intake'
              }
              autoFocus
            />
          </Field>
        </div>
      ) : null}

      {needsPhrase ? (
        <div className="mt-4">
          <Field label={`Type ${phrase} to confirm`} hint="The master id, as shown on the row.">
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
