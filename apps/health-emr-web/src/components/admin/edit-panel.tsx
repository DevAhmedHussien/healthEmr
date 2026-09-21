'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { EditIcon, SaveIcon } from '@/components/ui/icons';
import { MaskedInput } from '@/components/ui/masked-input';
import type { MaskName } from '@/components/form/masks';

/** Which field types are masked, and by which mask. */
const MASKED: Record<string, MaskName | undefined> = {
  phone: 'phone',
  date: 'dateUS',
  npi: 'npi',
  zip: 'zip',
};
import { SimpleSelect } from '@/components/ui/select';

export interface EditField {
  name: string;
  label: string;
  value: string | number | null;
  hint?: string;
  /**
   * `phone`, `date`, `npi` and `zip` are masked as they are typed and report the
   * raw value, so what reaches the API is digits rather than whatever
   * punctuation somebody happened to use.
   */
  type?:
    | 'text'
    | 'email'
    | 'number'
    | 'textarea'
    | 'states'
    | 'checkbox'
    | 'phone'
    | 'date'
    | 'npi'
    | 'zip';
  placeholder?: string;
}

/**
 * Edits a record, in the same dialog everything else uses.
 *
 * Only the fields that actually changed are sent. That is not an optimisation —
 * a PATCH echoing every field back writes an audit entry claiming the operator
 * touched all of them, which makes the trail useless for answering "who changed
 * the contact address". The dialog says what it is about to send, so that
 * behaviour is visible rather than implied.
 */
export function EditPanel({
  title,
  path,
  fields,
  reason: reasonMode = 'optional',
  label = 'Edit',
}: {
  title: string;
  path: string;
  fields: EditField[];
  /**
   * Whether the change has to carry a note, and whether one is offered at all.
   *
   * This used to be a boolean called `requireReason` that showed the field and
   * labelled it optional — so a form sitting in front of an API that demands a
   * reason let you submit without one and answered 400. `required` now means
   * required, matching `ActionDialog`, which always worked this way.
   */
  reason?: 'none' | 'optional' | 'required';
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Ten characters, the same floor the audited endpoints enforce.
  const reasonTooShort = reasonMode === 'required' && reason.trim().length < 10;

  function initial() {
    return Object.fromEntries(
      fields.map((field) => [field.name, field.value === null ? '' : String(field.value)]),
    );
  }

  const original = initial();
  const changed = fields.filter((field) => values[field.name] !== original[field.name]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const field of changed) {
        const raw = values[field.name];
        if (field.type === 'number') body[field.name] = raw === '' ? null : Number(raw);
        else if (field.type === 'states') {
          body[field.name] = raw
            .split(/[,\s]+/)
            .map((state) => state.trim().toUpperCase())
            .filter(Boolean);
        } else if (field.type === 'checkbox') body[field.name] = raw === 'true';
        else body[field.name] = raw === '' ? null : raw;
      }
      if (reasonMode !== 'none' && reason.trim()) body.reason = reason.trim();

      await api(path, { method: 'PATCH', body: JSON.stringify(body) });
      setSaved(true);
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        icon={EditIcon}
        onClick={() => {
          setSaved(false);
          setError(null);
          setValues(initial());
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {saved ? <span className="text-[0.8rem] text-[var(--ar-on-success)]">Saved</span> : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description="Only the fields you change are sent, so the record shows what actually moved."
        width="lg"
        footer={
          <>
            <p className="mr-auto text-[0.78rem] text-[var(--ar-text-faint)]">
              {changed.length
                ? `${changed.length} changed: ${changed.map((field) => field.label).join(', ')}`
                : 'Nothing changed yet.'}
            </p>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              icon={SaveIcon}
              onClick={save}
              disabled={busy || !changed.length || reasonTooShort}
            >
              {busy ? 'Saving…' : 'Save changes'}
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
          {fields.map((field) => (
            <div
              key={field.name}
              className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}
            >
              <Field label={field.label} hint={field.hint}>
                {field.type === 'textarea' ? (
                  <Textarea
                    rows={3}
                    value={values[field.name]}
                    onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  />
                ) : MASKED[field.type ?? 'text'] ? (
                  <MaskedInput
                    mask={MASKED[field.type ?? 'text']!}
                    value={values[field.name]}
                    placeholder={field.placeholder}
                    onValueChange={(raw) => setValues({ ...values, [field.name]: raw })}
                  />
                ) : field.type === 'checkbox' ? (
                  <SimpleSelect
                    value={values[field.name]}
                    onValueChange={(value) => setValues({ ...values, [field.name]: value })}
                    options={[
                      { value: 'true', label: 'Yes' },
                      { value: 'false', label: 'No' },
                    ]}
                  />
                ) : (
                  <Input
                    type={
                      field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'
                    }
                    value={values[field.name]}
                    placeholder={field.placeholder}
                    onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                  />
                )}
              </Field>
            </div>
          ))}
        </div>

        {reasonMode !== 'none' ? (
          <div className="mt-4">
            <Field
              label={reasonMode === 'required' ? 'Why' : 'Reason (optional)'}
              hint={
                reasonMode === 'required'
                  ? 'Required. Recorded in the audit log alongside the old and new values.'
                  : 'Recorded with the change.'
              }
            >
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this changing?"
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
