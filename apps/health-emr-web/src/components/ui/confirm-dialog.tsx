'use client';

import * as React from 'react';
import { Alert, Button } from './primitives';
import { Modal } from './modal';
import { AlertTriangleIcon, TrashIcon } from './icons';

/**
 * Confirmation before something is removed.
 *
 * Two rules, both from the same idea — that a person should know what is about
 * to happen before it happens, not after:
 *
 * 1. It names the thing. "Remove this?" is a question nobody can answer; "Remove
 *    Sema 2.5 from Weight management?" is.
 * 2. It states the actual consequence, including when that consequence is *not*
 *    deletion. Anything that has been dispensed is deactivated rather than
 *    deleted, and somebody who clicked "Remove" expecting it to disappear
 *    deserves to be told that before they click, not to discover it afterwards.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  consequence,
  confirmLabel = 'Remove',
  busy = false,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** What is being removed, named. */
  body: React.ReactNode;
  /** What will actually happen — deletion, or deactivation, and why. */
  consequence?: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      tone="danger"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={TrashIcon} onClick={onConfirm} disabled={busy}>
            {busy ? 'Removing…' : confirmLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="text-[0.9rem] leading-relaxed text-[var(--ar-body-color)]">{body}</div>

      {consequence ? (
        <div className="mt-4 flex gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-3.5 py-3">
          <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
          <p className="text-[0.82rem] leading-relaxed text-[#8A4B0A]">{consequence}</p>
        </div>
      ) : null}
    </Modal>
  );
}
