'use client';

import * as React from 'react';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { formatDateTime } from '@/lib/format';

export interface VisitPhoto {
  id: string;
  kind: string;
  mime: string;
  size: number;
  fileName: string;
  uploadedAt: string;
}

const KIND_LABEL: Record<string, string> = {
  ID_PHOTO: 'Identification',
  RX_PHOTO: 'Uploaded photo',
};

function readableSize(bytes: number): string {
  if (!bytes) return 'unknown size';
  return bytes < 1_048_576
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * The photographs a patient uploaded with their intake.
 *
 * Each image is fetched on demand through the visit — the list only ever carries
 * ids, so nothing is transferred until somebody looks, and each look is one
 * recorded read rather than a silent bulk disclosure of every photo on the page.
 *
 * `endpoint` differs by role (a clinician reads through `/clinic`, a client
 * business through `/admin`) and each of those routes re-checks that the
 * document belongs to a visit the caller may see. The component never decides
 * access; it only decides layout.
 */
export function VisitPhotos({
  endpoint,
  photos,
  title = 'Photos',
  subtitle = 'Uploaded by the patient. Opening one is recorded against their chart.',
  preview = false,
}: {
  /** BFF path for one photo, with `{id}` where the document id goes. */
  endpoint: string;
  photos: VisitPhoto[];
  title?: string;
  subtitle?: string;
  /**
   * Render the images inline rather than as cards to click.
   *
   * On for a clinician: they are being asked to verify an identity document
   * before prescribing, and a decision made without opening the photo is the
   * failure mode worth designing against.
   */
  preview?: boolean;
}) {
  const [open, setOpen] = React.useState<VisitPhoto | null>(null);
  const src = (photo: VisitPhoto) => endpoint.replace('{id}', photo.id);

  if (photos.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <p className="text-[0.85rem] text-[var(--ar-text-muted)]">
          The patient did not upload anything with this visit.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />

      <ul
        className={
          preview ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
        }
      >
        {photos.map((photo) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setOpen(photo)}
              className="w-full overflow-hidden rounded-[var(--ar-radius)] border border-[var(--ar-border)] text-left transition-colors hover:border-[var(--ar-primary)]"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src(photo)}
                  alt={`${KIND_LABEL[photo.kind] ?? 'Uploaded photo'} for this visit`}
                  className="h-44 w-full bg-[var(--ar-gray-50)] object-contain"
                />
              ) : null}
              <span className="block p-3">
                <span className="block text-[0.85rem] font-medium text-[var(--ar-headings)]">
                  {KIND_LABEL[photo.kind] ?? photo.kind.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ar-text-muted)]">
                  {photo.fileName}
                </span>
                <span className="mt-0.5 block text-[0.72rem] text-[var(--ar-text-faint)]">
                  {readableSize(photo.size)} · {formatDateTime(photo.uploadedAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? (KIND_LABEL[open.kind] ?? open.fileName) : ''}
        width="lg"
      >
        {open ? (
          <figure className="space-y-2">
            {/* Streamed from the API, which checks the document belongs to this
                visit and records the read. Not a Next <Image>: these bytes are
                PHI and must not pass through the image optimiser's cache. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src(open)}
              alt={`${KIND_LABEL[open.kind] ?? 'Uploaded photo'} for this visit`}
              className="max-h-[70vh] w-full rounded-[var(--ar-radius)] object-contain"
            />
            <figcaption className="text-[0.75rem] text-[var(--ar-text-faint)]">
              {open.fileName} · {readableSize(open.size)} · uploaded{' '}
              {formatDateTime(open.uploadedAt)}
            </figcaption>
          </figure>
        ) : null}
      </Modal>
    </Card>
  );
}
