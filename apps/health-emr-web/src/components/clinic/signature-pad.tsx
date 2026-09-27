'use client';

import * as React from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button, Field, Input } from '@/components/ui/primitives';
import { RestoreIcon } from '@/components/ui/icons';

/**
 * Drawing a signature.
 *
 * The canvas is trimmed before it is read, so what is stored is the mark rather
 * than the mark plus whatever whitespace the clinician happened to leave around
 * it — a signature drawn in the corner would otherwise print as a speck.
 *
 * The typed name is not a duplicate of the drawing. It is what survives being
 * reproduced at three centimetres wide on a pharmacy label, and what a system
 * reading the record can compare against the prescriber on file.
 */
export function SignaturePad({
  name,
  onNameChange,
  onChange,
  existing,
}: {
  name: string;
  onNameChange: (next: string) => void;
  /** The trimmed PNG data URI, or null when the pad is empty. */
  onChange: (image: string | null) => void;
  /** What is already on file, shown until they start drawing over it. */
  existing?: string | null;
}) {
  const pad = React.useRef<SignatureCanvas>(null);
  const [drawn, setDrawn] = React.useState(false);
  const [showingExisting, setShowingExisting] = React.useState(Boolean(existing));

  const capture = () => {
    const canvas = pad.current;
    if (!canvas || canvas.isEmpty()) {
      onChange(null);
      setDrawn(false);
      return;
    }
    setDrawn(true);
    onChange(canvas.getTrimmedCanvas().toDataURL('image/png'));
  };

  const clear = () => {
    pad.current?.clear();
    setDrawn(false);
    setShowingExisting(false);
    onChange(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[0.92rem] font-medium">
            Signature<span className="ml-0.5 text-[var(--ar-primary)]">*</span>
          </span>
          {drawn || showingExisting ? (
            <button
              type="button"
              onClick={clear}
              className="flex items-center gap-1.5 text-[0.84rem] text-[var(--ar-primary)] hover:underline"
            >
              <RestoreIcon size={14} />
              Start again
            </button>
          ) : null}
        </div>

        <div className="relative rounded-[var(--ar-radius)] border border-[var(--ar-gray-300)] bg-[var(--ar-gray-50)]">
          {showingExisting && existing ? (
            <>
              {/* What is on file, shown until they draw over it. Using an img
                  rather than painting it onto the canvas keeps "what is saved"
                  and "what I am drawing now" visibly separate. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={existing}
                alt="The signature currently on file"
                className="absolute inset-0 m-auto max-h-[110px] max-w-[90%] object-contain opacity-60"
              />
              <span className="pointer-events-none absolute bottom-1 right-2 text-[0.72rem] text-[var(--ar-text-faint)]">
                on file — draw to replace
              </span>
            </>
          ) : null}
          <SignatureCanvas
            ref={pad}
            penColor="#0d1b2a"
            canvasProps={{
              className: 'w-full',
              style: { height: 130, touchAction: 'none' },
              'aria-label': 'Draw your signature',
            }}
            onEnd={() => {
              setShowingExisting(false);
              capture();
            }}
          />
        </div>
        <p className="mt-1.5 text-[0.82rem] text-[var(--ar-text-muted)]">
          Draw with a mouse, a trackpad or your finger.
        </p>
      </div>

      <Field
        label="Your name, as you sign it"
        hint="Printed on the prescription beside the drawing, where a signature is too small to read."
      >
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="e.g. Sam Lindqvist, MD"
          autoComplete="name"
        />
      </Field>
    </div>
  );
}

/**
 * The signature on file, and the means to change it.
 *
 * Lives on the clinician's own page rather than in the signing dialog, because
 * drawing a signature is a thing you do once and signing is a thing you do
 * sixty times — putting the pad in front of somebody at every signing would
 * make the sixtieth drawing worthless.
 */
export function SignatureCard({
  image,
  name,
  capturedAt,
  onSave,
}: {
  image: string | null;
  name: string | null;
  capturedAt: string | null;
  onSave: (next: { image: string; name: string }) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(!image);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState(name ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ready = Boolean(draft) && typed.trim().length >= 2;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ image: draft, name: typed.trim() });
      setEditing(false);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing && image) {
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`Signature of ${name ?? 'the clinician'}`} className="max-h-24" />
          <p className="mt-3 border-t border-[var(--ar-border-soft)] pt-3 text-[0.9rem] font-medium">
            {name}
          </p>
          {capturedAt ? (
            <p className="text-[0.8rem] text-[var(--ar-text-muted)]">
              Added {new Date(capturedAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Replace signature
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-[0.88rem] text-[var(--ar-on-danger)]">
          {error}
        </p>
      ) : null}

      <SignaturePad name={typed} onNameChange={setTyped} onChange={setDraft} existing={image} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Save signature'}
        </Button>
        {image ? (
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(null);
              setTyped(name ?? '');
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        ) : null}
        {/* Said here rather than only in the API: a clinician replacing their
            signature reasonably wonders what happens to what they already
            signed, and the answer is reassuring. */}
        <p className="text-[0.82rem] text-[var(--ar-text-muted)]">
          Replacing this changes nothing you have already signed.
        </p>
      </div>
    </div>
  );
}
