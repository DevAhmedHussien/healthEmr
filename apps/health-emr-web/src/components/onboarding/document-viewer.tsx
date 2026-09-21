'use client';

import * as React from 'react';
import { Badge, Button, statusTone } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/lib/format';
import { CheckIcon, EyeIcon, XIcon } from '@/components/ui/icons';

export interface ViewableDocument {
  id: string;
  kind: string;
  state?: string | null;
  fileName: string;
  mime: string;
  size: number;
  expiresAt?: string | null;
  reviewStatus: string;
}

const pretty = (value: string) => value.replace(/_/g, ' ').toLowerCase();
const kb = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Views an uploaded document.
 *
 * Fetched through the BFF as a blob rather than pointed at with a plain `src`:
 * the file needs the session cookie to be readable at all, which is the point —
 * these are photo IDs and licence scans, and there is no URL that serves them to
 * an anonymous caller.
 *
 * The object URL is revoked when the preview closes so the bytes do not sit in
 * memory for the rest of the session.
 */
export function DocumentViewer({
  scope,
  documents,
  onReview,
  busy,
}: {
  scope: 'provider' | 'pharmacy';
  documents: ViewableDocument[];
  onReview?: (documentId: string, decision: 'ACCEPTED' | 'REJECTED') => void;
  busy?: boolean;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const open = documents.find((doc) => doc.id === openId) ?? null;

  React.useEffect(() => {
    if (!openId) return;

    let revoked = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);

    fetch(`/api/bff/v1/super-admin/onboarding/${scope}/documents/${openId}/file`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load the file (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setLoading(false);
      })
      .catch((caught: Error) => {
        if (revoked) return;
        setError(caught.message);
        setLoading(false);
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
      setBlobUrl(null);
    };
  }, [openId, scope]);

  if (documents.length === 0) {
    return <p className="text-[0.9rem] text-[var(--ar-text-muted)]">Nothing uploaded yet.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--ar-radius)] border border-[var(--ar-border)] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.88rem] font-medium">
                {pretty(doc.kind)}
                {doc.state ? ` · ${doc.state}` : ''}
              </p>
              <p className="truncate text-[0.75rem] text-[var(--ar-text-faint)]">
                {doc.fileName} · {kb(doc.size)}
                {doc.expiresAt ? ` · expires ${formatDateShort(doc.expiresAt)}` : ''}
              </p>
            </div>

            <div className="flex flex-none items-center gap-2">
              <Badge tone={statusTone(doc.reviewStatus)}>{doc.reviewStatus.toLowerCase()}</Badge>
              <Button size="sm" variant="outline" icon={EyeIcon} onClick={() => setOpenId(doc.id)}>
                View
              </Button>
              {onReview && doc.reviewStatus === 'PENDING' ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={CheckIcon}
                    disabled={busy}
                    onClick={() => onReview(doc.id, 'ACCEPTED')}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={XIcon}
                    disabled={busy}
                    onClick={() => onReview(doc.id, 'REJECTED')}
                  >
                    Reject
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${pretty(open.kind)} — ${open.fileName}`}
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 md:p-8"
          onClick={() => setOpenId(null)}
          onKeyDown={(event) => event.key === 'Escape' && setOpenId(null)}
        >
          <div
            className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-[var(--ar-radius-lg)] bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--ar-border)] px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{pretty(open.kind)}</p>
                <p className="truncate text-[0.75rem] text-[var(--ar-text-faint)]">
                  {open.fileName} · {kb(open.size)}
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                {blobUrl ? (
                  <a
                    href={blobUrl}
                    download={open.fileName}
                    className="rounded-[var(--ar-radius)] border border-[var(--ar-primary)] px-3 py-1.5 text-[0.8rem] font-medium text-[var(--ar-primary)]"
                  >
                    Download
                  </a>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={XIcon}
                  onClick={() => setOpenId(null)}
                  autoFocus
                >
                  Close
                </Button>
              </div>
            </header>

            <div
              className={cn(
                'flex-1 overflow-auto bg-[var(--ar-gray-50)] p-4',
                loading && 'grid place-items-center',
              )}
            >
              {loading ? (
                <p className="text-[0.9rem] text-[var(--ar-text-muted)]">Loading…</p>
              ) : error ? (
                <p className="text-[0.9rem] text-[var(--ar-danger)]">{error}</p>
              ) : blobUrl && open.mime === 'application/pdf' ? (
                <iframe
                  src={blobUrl}
                  title={open.fileName}
                  className="h-full min-h-[60vh] w-full rounded bg-white"
                />
              ) : blobUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={blobUrl}
                  alt={pretty(open.kind)}
                  className="mx-auto max-h-full rounded object-contain"
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
