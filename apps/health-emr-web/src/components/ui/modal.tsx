'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from './primitives';
import { XIcon } from './icons';

/**
 * The one dialog in the console.
 *
 * Adding, editing and removing a record are the same interaction wearing
 * different words, so they share a shell: same overlay, same escape key, same
 * focus behaviour, same place for the confirm button. A person who has archived
 * a pharmacy already knows how to edit one.
 *
 * Focus is trapped while open and returned to whatever opened it on close —
 * without that, dismissing a dialog drops keyboard focus to the top of the
 * document and a keyboard user has to walk the whole page back.
 *
 * Rendered through a portal onto `document.body`. Most of these are opened from
 * a button inside a table cell, and `position: fixed` does not escape the DOM:
 * the panel stayed a descendant of a `<td>` and inherited its `white-space:
 * nowrap`, so a long description ran straight out of the dialog and across the
 * page. A portal takes the dialog out of that subtree entirely, which also keeps
 * it clear of any ancestor's `overflow: hidden` or stacking context.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  tone = 'default',
  footer,
  children,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * A sentence under the title. Pass an array to put each on its own line —
   * two short lines are read; one long one is skipped.
   */
  description?: string | string[];
  /** `danger` tints the header, for actions that remove or close something. */
  tone?: 'default' | 'danger';
  footer?: React.ReactNode;
  children?: React.ReactNode;
  width?: 'md' | 'lg';
}) {
  const panel = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<Element | null>(null);

  /**
   * Held in a ref so the effect below does not depend on its identity.
   *
   * Callers write `onClose={() => setOpen(false)}`, which is a new function on
   * every parent render. With `onClose` in the dependency list, each of those
   * renders tore down the focus trap and ran its cleanup — which restores focus
   * to whatever opened the dialog. The result was a dialog that kept throwing
   * focus back out to the button behind it, worst on forms, because those
   * re-render on every keystroke.
   */
  const close = React.useRef(onClose);
  React.useEffect(() => {
    close.current = onClose;
  });
  const [mounted, setMounted] = React.useState(false);

  // A portal needs a DOM to aim at, and the server has none. Rendering nothing
  // until after hydration keeps the server and client markup identical.
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    // `mounted` matters as much as `open`: the portal renders nothing until
    // after hydration, so on the first pass there is no panel to find a
    // focusable element inside. Without it here the effect runs once against an
    // empty ref and never again, and focus stays on whatever opened the dialog.
    if (!open || !mounted) return;

    opener.current = document.activeElement;
    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('disabled'));

    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // An open dropdown inside the dialog handles Escape first and marks it
        // handled. Without this check, dismissing a select would also throw away
        // everything typed into the form behind it.
        if (event.defaultPrevented) return;
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    // The page behind a modal must not scroll; on a phone it otherwise scrolls
    // instead of the dialog and the confirm button drifts off screen.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  const lines =
    description === undefined ? [] : Array.isArray(description) ? description : [description];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(34,48,62,0.45)] p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          // `whitespace-normal` belongs here even with the portal. It costs
          // nothing and means a dialog can never again be silently reshaped by
          // wherever it happens to be mounted from.
          'my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden whitespace-normal rounded-[var(--ar-radius-lg)] bg-white shadow-[0_12px_40px_rgba(34,48,62,0.28)]',
          width === 'lg' ? 'max-w-[46rem]' : 'max-w-[32rem]',
        )}
      >
        <div
          className={cn(
            'flex flex-none items-start justify-between gap-3 px-6 py-4',
            tone === 'danger'
              ? 'bg-[var(--ar-danger-soft)]'
              : 'border-b border-[var(--ar-border-soft)]',
          )}
        >
          {/* `min-w-0` so the text column can shrink and wrap. A flex item
              defaults to `min-width: auto`, which refuses to go below its
              content and pushes the close button off the panel. */}
          <div className="min-w-0">
            <h2
              className={cn(
                'text-[1.05rem] font-medium',
                tone === 'danger' ? 'text-[var(--ar-on-danger)]' : 'text-[var(--ar-headings)]',
              )}
            >
              {title}
            </h2>
            {lines.length > 0 ? (
              <div className="mt-1.5 space-y-1">
                {lines.map((line) => (
                  <p
                    key={line}
                    className="text-[0.85rem] leading-relaxed text-pretty break-words text-[var(--ar-text-muted)]"
                  >
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={XIcon}
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 -mt-1 flex-none"
          />
        </div>

        {/* The body scrolls, not the page. A long form in a short window
            otherwise pushes the confirm button below the fold with no way to
            reach it. */}
        {children ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        ) : null}

        {footer ? (
          <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-[var(--ar-border-soft)] px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
