'use client';

import * as React from 'react';
import { US_STATES } from '@health-emr/types';
import { cn } from '@/lib/utils';

/**
 * A grid of toggles, one per option.
 *
 * Extracted from `ChipsField` so the same control works outside a react-hook-form
 * context — a pharmacy's states are edited in three different places, only one of
 * which is a managed form, and three implementations of "pick some states" is how
 * one of them ends up accepting `Tx` and another rejecting it.
 */
export function ChipGrid({
  options,
  value,
  onChange,
  columns = 6,
  invalid,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: readonly string[];
  onChange: (next: string[]) => void;
  columns?: number;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'grid max-h-52 gap-1.5 overflow-y-auto rounded-[var(--ar-radius)] border p-3',
        invalid ? 'border-[var(--ar-danger)]' : 'border-[var(--ar-gray-300)]',
      )}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? value.filter((chosen) => chosen !== option.value)
                  : [...value, option.value],
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
}

const STATE_OPTIONS = US_STATES.map((state) => ({ value: state, label: state }));

/**
 * The states a pharmacy will ship into.
 *
 * Typed as free text this was a comma-separated box, which is a quiet way to
 * lose a pharmacy: `TX, Tx , texas` all look reasonable while typing and only
 * one of them matches a patient's state at routing time. Picking from the list
 * makes the wrong value unrepresentable, and the count is shown because "did
 * that save all of them" is the question somebody asks immediately afterwards.
 */
export function StatesPicker({
  value,
  onChange,
  ariaLabel = 'States served',
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  ariaLabel?: string;
}) {
  const all = value.length === US_STATES.length;
  return (
    <div className="space-y-2">
      <ChipGrid options={STATE_OPTIONS} value={value} onChange={onChange} ariaLabel={ariaLabel} />
      <div className="flex items-center gap-3 text-[0.78rem]">
        <span className="text-[var(--ar-text-muted)]">
          {value.length
            ? `${value.length} of ${US_STATES.length} selected`
            : 'None selected — no stated restriction'}
        </span>
        <button
          type="button"
          className="ml-auto text-[var(--ar-primary)] hover:underline"
          onClick={() => onChange(all ? [] : [...US_STATES])}
        >
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>
    </div>
  );
}
