'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import {
  ArchiveIcon,
  CheckIcon,
  CreditCardIcon,
  RestoreIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from '@/components/ui/icons';

/**
 * Icons are named rather than passed.
 *
 * Most callers are server components, and a React component is a function —
 * which cannot cross the server/client boundary. A string can, so the caller
 * names the glyph and this module resolves it.
 */
const GLYPHS = {
  archive: ArchiveIcon,
  restore: RestoreIcon,
  trash: TrashIcon,
  send: SendIcon,
  check: CheckIcon,
  close: XIcon,
  invoice: CreditCardIcon,
} as const;

export type GlyphName = keyof typeof GLYPHS;

export interface ActionDialogProps {
  /** Button label, and the dialog's title. */
  label: string;
  /** What the dialog explains before asking for confirmation. */
  /** Pass an array to give each sentence its own line. */
  description: string | string[];
  /** BFF path, e.g. `v1/super-admin/providers/123`. */
  path: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  /** Fields merged into the request body alongside the reason. */
  body?: Record<string, unknown>;
  /**
   * Whether a reason is required. Destructive actions always ask; the server
   * enforces it too, so this is a courtesy rather than the control.
   */
  requireReason?: boolean;
  confirmLabel?: string;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  icon?: GlyphName;
  /** Shown on success instead of closing silently. */
  successMessage?: string;
}

/**
 * A privileged action, behind a confirmation that asks why.
 *
 * The reason is not paperwork: it is written to the audit log and is the only
 * part of an archival somebody reading the trail in two years cannot reconstruct
 * from the data itself. Making it a required field of the action — rather than
 * an optional note afterwards — is what keeps it honest.
 */
export function ActionDialog({
  label,
  description,
  path,
  method = 'POST',
  body,
  requireReason = true,
  confirmLabel,
  variant = 'outline',
  size = 'sm',
  icon,
  successMessage,
}: ActionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const destructive = variant === 'danger' || method === 'DELETE';
  // Falls back to the action's own shape: archiving and restoring are the two
  // most common, and an unlabelled icon would be worse than none.
  const glyph = icon
    ? GLYPHS[icon]
    : destructive
      ? ArchiveIcon
      : /restore/i.test(label)
        ? RestoreIcon
        : undefined;

  const tooShort = requireReason && reason.trim().length < 10;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(path, {
        method,
        body: JSON.stringify({
          ...(body ?? {}),
          ...(requireReason ? { reason: reason.trim() } : {}),
        }),
      });
      setOpen(false);
      setReason('');
      setDone(successMessage ?? `${label} — done.`);
      // The page is a server component; refresh re-reads it rather than us
      // guessing what the mutation did to the rest of the screen.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={glyph}
        onClick={() => {
          setDone(null);
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>

      {done ? (
        <div className="mt-2">
          <Alert tone="success">{done}</Alert>
        </div>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        description={description}
        tone={destructive ? 'danger' : 'default'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              icon={glyph}
              onClick={submit}
              disabled={busy || tooShort}
            >
              {busy ? 'Working…' : (confirmLabel ?? label)}
            </Button>
          </>
        }
      >
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        {requireReason ? (
          <Field label="Reason" hint="Written to the audit log. At least 10 characters.">
            <Textarea
              autoFocus
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this happening?"
            />
          </Field>
        ) : (
          <p className="text-[0.875rem] text-[var(--ar-text-muted)]">
            This will be recorded against your account.
          </p>
        )}
      </Modal>
    </>
  );
}
