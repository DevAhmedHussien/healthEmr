'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { maskDateUS } from '@/components/form/masks';
import { CalendarIcon } from '@/components/ui/icons';

/**
 * A date, typed and read as `MM-DD-YYYY`, everywhere in the console.
 *
 * A bare `<input type="date">` renders in the *browser's* locale: the same
 * field reads `09/19/2026` on one machine and `19/09/2026` on another, and
 * neither matches how the rest of this console writes dates. A clinician
 * comparing a filter against a table cell should not have to work out which
 * convention each one is using.
 *
 * So the visible field is text under a mask, and the native picker is kept —
 * behind a calendar button that opens it. Typing and picking both land in the
 * same place. The value crossing this component's boundary is always ISO
 * `YYYY-MM-DD`, which is what every API and URL parameter here expects; the
 * display format is this component's business and nobody else's.
 */
export function DateField({
  value,
  onValueChange,
  label,
  id,
  className,
  disabled,
  min,
  max,
}: {
  /** ISO `YYYY-MM-DD`, or empty. */
  value: string;
  onValueChange: (iso: string) => void;
  /** Accessible name. Required — a bare date box is unreadable to a screen reader. */
  label: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
}) {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const picker = React.useRef<HTMLInputElement>(null);

  const [text, setText] = React.useState(() => isoToDisplay(value));

  // Re-derive when the value changes from outside — a cleared filter, a reset
  // form — but leave a half-typed date alone while it is being typed.
  React.useEffect(() => {
    setText((current) => (displayToIso(current) === value ? current : isoToDisplay(value)));
  }, [value]);

  function onType(next: string) {
    const masked = maskDateUS(next).display;
    setText(masked);

    const iso = displayToIso(masked);
    // Only report a date that is actually a date. Reporting every keystroke
    // would refetch the table on "0", "09", "09-1"…
    if (iso !== null || masked === '') onValueChange(iso ?? '');
  }

  return (
    <div className={cn('relative', className)}>
      <input
        id={fieldId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM-DD-YYYY"
        aria-label={label}
        disabled={disabled}
        value={text}
        onChange={(event) => onType(event.target.value)}
        className="ar-input pr-9"
      />

      {/* The native picker, kept for people who would rather point than type.
          Zero-sized rather than `display:none`: a hidden input cannot be told
          to `showPicker()`. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          setText(isoToDisplay(event.target.value));
          onValueChange(event.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-8 h-0 w-0 opacity-0"
      />

      <button
        type="button"
        disabled={disabled}
        aria-label={`Choose ${label.toLowerCase()} from a calendar`}
        onClick={() => picker.current?.showPicker?.()}
        className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[var(--ar-radius-sm)] text-[var(--ar-text-faint)] transition hover:bg-[var(--ar-body-bg)] hover:text-[var(--ar-primary)] disabled:opacity-40"
      >
        <CalendarIcon size={15} />
      </button>
    </div>
  );
}

/** `2026-09-19` → `09-19-2026`. Empty in, empty out. */
function isoToDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[2]}-${match[3]}-${match[1]}` : '';
}

/**
 * `09-19-2026` → `2026-09-19`, or null while it is still being typed.
 *
 * Null rather than a guess. A partial date is not a date, and treating
 * `09-19-20` as the year 20 would quietly file a record two millennia early.
 */
function displayToIso(display: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(display);
  if (!match) return null;

  const [, month, day, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  // Rejects 02-31: `Date` rolls it forward to March rather than refusing.
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day)) return null;

  return `${year}-${month}-${day}`;
}
