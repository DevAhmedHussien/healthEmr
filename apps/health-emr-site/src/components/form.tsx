'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { isoToDisplay, MASKS, maskDateUS, type MaskName } from '@/lib/masks';

/**
 * Form controls for the public applications.
 *
 * Deliberately plainer than the product's: someone filling this in is a
 * stranger on a phone who has not been trained on anything. Every field says
 * what it wants before they type, errors sit against the field rather than in a
 * summary at the top, and nothing is hidden behind a control that has to be
 * discovered.
 */

const CONTROL =
  'w-full rounded-[var(--radius)] border bg-white px-3.5 py-2.5 text-[1rem] text-[var(--ink)] ' +
  'placeholder:text-[var(--faint)] transition outline-none focus:border-[var(--brand)] ' +
  'focus:ring-4 focus:ring-[var(--brand)]/12';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="block text-[0.92rem] font-medium">
        {label}
        {required ? <span className="ml-0.5 text-[var(--brand)]">*</span> : null}
      </span>
      {hint ? <span className="mt-0.5 block text-[0.84rem] text-[var(--muted)]">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
      {error ? (
        <span role="alert" className="mt-1.5 block text-[0.84rem] text-[#b3261e]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function Input({
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      className={clsx(CONTROL, error ? 'border-[#b3261e]' : 'border-[var(--line)]')}
    />
  );
}

export function Textarea({
  error,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return (
    <textarea
      {...props}
      className={clsx(CONTROL, 'resize-y', error ? 'border-[#b3261e]' : 'border-[var(--line)]')}
    />
  );
}

export function Select({
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select
      {...props}
      className={clsx(CONTROL, 'appearance-none', error ? 'border-[#b3261e]' : 'border-[var(--line)]')}
    >
      {children}
    </select>
  );
}

/**
 * An input that formats as it is typed.
 *
 * The field shows the formatted value and reports the raw one, so what a person
 * reads and what the API receives can differ without either side having to know
 * about the other. A date is shown MM-DD-YYYY and reported as ISO.
 */
export function MaskedInput({
  mask,
  value,
  onValueChange,
  error,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  mask: MaskName;
  /** The raw value — digits for a phone, ISO for a date. */
  value: string;
  onValueChange: (raw: string) => void;
  error?: boolean;
}) {
  const apply = MASKS[mask];
  const [display, setDisplay] = React.useState(() =>
    mask === 'date' ? isoToDisplay(value ?? '') : apply(value ?? '').display,
  );

  // Follow the value when it is changed from outside — a reset, or a row being
  // removed from the list above this one.
  React.useEffect(() => {
    const incoming = mask === 'date' ? isoToDisplay(value ?? '') : apply(value ?? '').display;
    setDisplay((current) => {
      const currentRaw = mask === 'date' ? maskDateUS(current).raw : apply(current).raw;
      return currentRaw === (value ?? '') ? current : incoming;
    });
  }, [value, apply, mask]);

  return (
    <input
      {...props}
      value={display}
      inputMode={mask === 'phone' ? 'tel' : 'numeric'}
      autoComplete={props.autoComplete ?? (mask === 'phone' ? 'tel' : 'off')}
      onChange={(event) => {
        const next = apply(event.target.value);
        setDisplay(next.display);
        onValueChange(next.raw);
      }}
      className={clsx(CONTROL, error ? 'border-[#b3261e]' : 'border-[var(--line)]')}
    />
  );
}

export function Checkbox({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-white p-3.5 transition hover:border-[var(--muted)]">
      <input type="checkbox" {...props} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
      <span>
        <span className="block text-[0.95rem] font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-[0.86rem] text-[var(--muted)]">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * A grid of state toggles.
 *
 * Typed as free text this is a comma-separated box, and `TX`, `Tx ` and
 * `texas` all look reasonable while typing. Only one of them matches a
 * patient's state later, so picking from the list makes the wrong value
 * impossible rather than merely discouraged.
 */
export function StatePicker({
  states,
  value,
  onChange,
  label,
}: {
  states: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  const all = value.length === states.length;
  return (
    <div>
      <div
        role="group"
        aria-label={label}
        className="grid max-h-56 grid-cols-6 gap-1.5 overflow-y-auto rounded-[var(--radius)] border border-[var(--line)] bg-white p-3 sm:grid-cols-9"
      >
        {states.map((state) => {
          const on = value.includes(state);
          return (
            <button
              key={state}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((s) => s !== state) : [...value, state])}
              className={clsx(
                'rounded-md py-1.5 text-[0.8rem] transition',
                on
                  ? 'bg-[var(--brand)] font-medium text-white'
                  : 'bg-[var(--paper-tint)] text-[var(--muted)] hover:bg-[var(--line-soft)]',
              )}
            >
              {state}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[0.86rem]">
        <span className="text-[var(--muted)]">
          {value.length ? `${value.length} selected` : 'None selected'}
        </span>
        <button
          type="button"
          onClick={() => onChange(all ? [] : [...states])}
          className="ml-auto text-[var(--brand)] hover:underline"
        >
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex items-center justify-center rounded-full bg-[var(--brand)] px-7 py-3 text-[1rem] font-medium text-white transition hover:bg-[var(--brand-hover)] disabled:opacity-60"
    >
      {busy ? 'Sending…' : children}
    </button>
  );
}

/** Groups fields under a heading, so a long form reads as a few short ones. */
export function Fieldset({
  legend,
  hint,
  children,
  columns = 2,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-1 text-[1.15rem] font-semibold tracking-[-0.02em]">{legend}</legend>
      {hint ? <p className="mb-5 text-[0.92rem] text-[var(--muted)]">{hint}</p> : <div className="mb-5" />}
      <div className={clsx('grid gap-5', columns === 2 && 'sm:grid-cols-2')}>{children}</div>
    </fieldset>
  );
}

/** What replaces the form once it has been sent. */
export function Sent({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-xl)] bg-[var(--paper-tint)] p-10 text-center">
      <div
        aria-hidden
        className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--brand)] text-[1.4rem] text-white"
      >
        ✓
      </div>
      <h2 className="t-title mt-5">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-[1rem] text-[var(--muted)]">{body}</p>
    </div>
  );
}
