'use client';

import * as React from 'react';
import {
  Controller,
  useFormContext,
  type FieldValues,
  type Path,
  type RegisterOptions,
} from 'react-hook-form';
import { cn } from '@/lib/utils';
import { MASKS, type MaskName } from './masks';
import { SimpleSelect } from '@/components/ui/select';

/**
 * Form fields bound to React Hook Form.
 *
 * Every field reads its error from the form context rather than taking it as a
 * prop, so validation wiring cannot drift from the schema. Errors are announced
 * with `aria-invalid` and `aria-describedby`, not just coloured red — a screen
 * reader should learn what is wrong at the same moment everyone else does.
 */

function useFieldError(name: string) {
  const { formState } = useFormContext();
  return name
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], formState.errors) as
    { message?: string } | undefined;
}

function Shell({
  name,
  label,
  hint,
  required,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const error = useFieldError(name);

  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-[0.857rem] font-medium">
        {label}
        {required ? <span className="ml-0.5 text-[var(--ar-danger)]">*</span> : null}
      </label>
      {children}
      {error?.message ? (
        <p
          id={`${name}-error`}
          role="alert"
          className="mt-1 text-[0.75rem] text-[var(--ar-danger)]"
        >
          {error.message}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="mt-1 text-[0.75rem] text-[var(--ar-text-faint)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const base = 'ar-input';
const invalid = 'border-[var(--ar-danger)] focus:border-[var(--ar-danger)]';

interface BaseProps<T extends FieldValues> {
  name: Path<T>;
  label: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  rules?: RegisterOptions<T, Path<T>>;
}

export function TextField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  placeholder,
  type = 'text',
  autoComplete,
}: BaseProps<T> & { type?: string; autoComplete?: string }) {
  const { register } = useFormContext<T>();
  const error = useFieldError(name);

  return (
    <Shell name={name} label={label} hint={hint} required={required}>
      <input
        id={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={cn(base, error && invalid)}
        {...register(name)}
      />
    </Shell>
  );
}

/**
 * A password input that can be revealed.
 *
 * Typing a password you cannot see is how people mistype one, and on a phone
 * keyboard it is most of the reason sign-in fails twice before it works. The
 * toggle starts hidden and reverts to hidden on every render of a new field, so
 * revealing is always a deliberate act.
 *
 * The button is `tabIndex={-1}`: reaching the password field and pressing Tab
 * should submit-ward to the next field, not land on an eye. It stays reachable
 * by pointer and is announced by its `aria-label`, which changes with the state
 * so a screen-reader user knows whether the password is currently visible.
 */
export function PasswordField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  placeholder,
  autoComplete = 'current-password',
}: BaseProps<T> & { autoComplete?: string }) {
  const { register } = useFormContext<T>();
  const error = useFieldError(name);
  const [visible, setVisible] = React.useState(false);

  return (
    <Shell name={name} label={label} hint={hint} required={required}>
      <div className="relative">
        <input
          id={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
          // Room for the button, so a long password never runs underneath it.
          className={cn(base, 'pr-11', error && invalid)}
          {...register(name)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          className={cn(
            'absolute inset-y-0 right-0 flex w-11 items-center justify-center',
            'text-[var(--ar-text-faint)] transition-colors hover:text-[var(--ar-primary)]',
            'focus-visible:outline-none focus-visible:text-[var(--ar-primary)]',
          )}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
    </Shell>
  );
}

/** Open eye while hidden, struck-through eye while revealed. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.75" />
      {off ? <line x1="4" y1="20" x2="20" y2="4" /> : null}
    </svg>
  );
}

/**
 * A masked text input.
 *
 * The field shows `display` and the form holds `raw`, so what a person reads and
 * what the API receives can differ without either side knowing about the other.
 */
export function MaskedField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  placeholder,
  mask,
  inputMode = 'numeric',
}: BaseProps<T> & { mask: MaskName; inputMode?: 'numeric' | 'text' }) {
  const { control } = useFormContext<T>();
  const error = useFieldError(name);
  const apply = MASKS[mask];

  return (
    <Shell name={name} label={label} hint={hint} required={required}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <input
            id={name}
            inputMode={inputMode}
            placeholder={placeholder}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
            className={cn(base, error && invalid)}
            value={apply(String(field.value ?? '')).display}
            onChange={(event) => field.onChange(apply(event.target.value).raw)}
            onBlur={field.onBlur}
          />
        )}
      />
    </Shell>
  );
}

export function SelectField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  options,
  placeholder = 'Select…',
}: BaseProps<T> & { options: Array<{ value: string; label: string }> }) {
  const error = useFieldError(name);

  return (
    <Shell name={name} label={label} hint={hint} required={required}>
      {/*
        Controlled rather than registered: the field renders a button and a
        portalled listbox, not an <select>, so there is no DOM node for
        `register` to read a value from. Controller is the bridge react-hook-form
        provides for exactly this.
      */}
      <Controller
        name={name}
        render={({ field }) => (
          <SimpleSelect
            name={field.name}
            value={field.value ?? ''}
            onValueChange={field.onChange}
            placeholder={placeholder}
            invalid={Boolean(error)}
            options={options}
          />
        )}
      />
    </Shell>
  );
}

export function TextAreaField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  placeholder,
  rows = 4,
}: BaseProps<T> & { rows?: number }) {
  const { register } = useFormContext<T>();
  const error = useFieldError(name);

  return (
    <Shell name={name} label={label} hint={hint} required={required}>
      <textarea
        id={name}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={cn(base, 'resize-y', error && invalid)}
        {...register(name)}
      />
    </Shell>
  );
}

export function CheckboxField<T extends FieldValues>({
  name,
  label,
  hint,
}: {
  name: Path<T>;
  label: string;
  hint?: string;
}) {
  const { register } = useFormContext<T>();
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-0.5" {...register(name)} />
      <span>
        <span className="text-[0.9rem]">{label}</span>
        {hint ? (
          <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Multi-select rendered as toggle chips — dense enough for 51 states. */
export function ChipsField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  options,
  columns = 6,
}: BaseProps<T> & { options: Array<{ value: string; label: string }>; columns?: number }) {
  const { control } = useFormContext<T>();
  const error = useFieldError(name);

  return (
    <Shell name={name} label={label} hint={hint} required={required}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => {
          const chosen: string[] = Array.isArray(field.value) ? field.value : [];
          return (
            <div
              className={cn(
                'grid max-h-52 gap-1.5 overflow-y-auto rounded-[var(--ar-radius)] border p-3',
                error ? 'border-[var(--ar-danger)]' : 'border-[var(--ar-gray-300)]',
              )}
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {options.map((option) => {
                const active = chosen.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      field.onChange(
                        active
                          ? chosen.filter((value) => value !== option.value)
                          : [...chosen, option.value],
                      )
                    }
                    className={cn(
                      'rounded-[var(--ar-radius)] px-2 py-1 text-[0.78rem] transition',
                      active
                        ? 'bg-[var(--ar-primary)] text-white'
                        : 'bg-[var(--ar-gray-50)] text-[var(--ar-text-muted)] hover:bg-[var(--ar-gray-200)]',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          );
        }}
      />
    </Shell>
  );
}
