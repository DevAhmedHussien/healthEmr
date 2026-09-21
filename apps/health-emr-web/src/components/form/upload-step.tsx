'use client';

import * as React from 'react';
import { Alert, Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { SimpleSelect } from '@/components/ui/select';
import { CheckIcon } from '@/components/ui/icons';

export interface RequiredDocument {
  kind: string;
  label: string;
  /** Ask for a state alongside, as a per-state licence needs. */
  perState?: boolean;
}

interface Uploaded {
  id: string;
  kind: string;
  state?: string;
  fileName: string;
}

/**
 * Document upload, inside the application rather than after it.
 *
 * Asking for files only once the form is submitted loses the applicant's
 * attention at exactly the moment the paperwork gets tedious — and an
 * application with no documents cannot be reviewed, so it just sits there. Here
 * the checklist is visible while they fill it in.
 *
 * Uploads post as they are chosen, against the application id, so a dropped
 * connection loses one file rather than the whole submission.
 */
export function UploadStep({
  scope,
  applicationId,
  required,
  states = [],
  onChange,
}: {
  scope: 'provider' | 'pharmacy';
  applicationId: string | null;
  required: RequiredDocument[];
  states?: string[];
  onChange?: (uploaded: Uploaded[]) => void;
}) {
  const [uploaded, setUploaded] = React.useState<Uploaded[]>([]);
  const [busyKind, setBusyKind] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [stateFor, setStateFor] = React.useState<Record<string, string>>({});

  const upload = async (kind: string, file: File) => {
    if (!applicationId) return;

    setBusyKind(kind);
    setError(null);

    const body = new FormData();
    body.append('file', file);
    body.append('kind', kind);
    const state = stateFor[kind];
    if (state) body.append('state', state);

    try {
      const response = await fetch(
        `/api/bff/v1/public/onboarding/${scope}/${applicationId}/documents`,
        { method: 'POST', body },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Upload failed');

      const next = [...uploaded, { id: result.id, kind, state, fileName: result.fileName }];
      setUploaded(next);
      onChange?.(next);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyKind(null);
    }
  };

  const countFor = (kind: string) => uploaded.filter((doc) => doc.kind === kind).length;

  return (
    <div className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      {!applicationId ? (
        <Alert tone="info">
          Finish the previous steps first — files attach to your application once it exists.
        </Alert>
      ) : null}

      <div className="space-y-2.5">
        {required.map((requirement) => {
          const count = countFor(requirement.kind);
          const done = count > 0;

          return (
            <div
              key={requirement.kind}
              className={cn(
                'rounded-[var(--ar-radius)] border p-3.5 transition',
                done
                  ? 'border-[var(--ar-success)] bg-[var(--ar-success-soft)]'
                  : 'border-[var(--ar-gray-300)]',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-6 w-6 flex-none place-items-center rounded-full text-[0.7rem]',
                      done
                        ? 'bg-[var(--ar-success)] text-white'
                        : 'bg-[var(--ar-gray-200)] text-[var(--ar-text-muted)]',
                    )}
                  >
                    {done ? <CheckIcon size={14} strokeWidth={3} /> : '○'}
                  </span>
                  <span className="text-[0.88rem] font-medium">{requirement.label}</span>
                  {count > 1 ? <Badge tone="success">{count} files</Badge> : null}
                </div>

                <div className="flex items-center gap-2">
                  {requirement.perState && states.length > 0 ? (
                    <SimpleSelect
                      aria-label={`State for ${requirement.label}`}
                      className="w-auto min-w-[6rem] py-1 text-[0.78rem]"
                      value={stateFor[requirement.kind] ?? ''}
                      onValueChange={(value) =>
                        setStateFor((current) => ({ ...current, [requirement.kind]: value }))
                      }
                      placeholder="State…"
                      options={states.map((state) => ({ value: state, label: state }))}
                    />
                  ) : null}

                  <label
                    className={cn(
                      'cursor-pointer rounded-[var(--ar-radius)] border border-[var(--ar-primary)] px-3 py-1.5 text-[0.78rem] font-medium text-[var(--ar-primary)] transition hover:bg-[var(--ar-primary-soft)]',
                      (!applicationId || busyKind === requirement.kind) &&
                        'pointer-events-none opacity-50',
                    )}
                  >
                    {busyKind === requirement.kind
                      ? 'Uploading…'
                      : done
                        ? 'Add another'
                        : 'Choose file'}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      className="sr-only"
                      disabled={!applicationId || busyKind === requirement.kind}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(requirement.kind, file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              {uploaded
                .filter((doc) => doc.kind === requirement.kind)
                .map((doc) => (
                  <p
                    key={doc.id}
                    className="mt-1.5 pl-8 text-[0.75rem] text-[var(--ar-text-muted)]"
                  >
                    {doc.fileName}
                    {doc.state ? ` · ${doc.state}` : ''}
                  </p>
                ))}
            </div>
          );
        })}
      </div>

      <p className="text-[0.78rem] text-[var(--ar-text-faint)]">
        PDF, PNG or JPEG, up to 15MB. We check the contents match the extension, so a file merely
        renamed to .pdf is refused.
      </p>
    </div>
  );
}
