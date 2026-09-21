'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from './icons';

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Choosing several options from a list.
 *
 * A row of chips works for five options and collapses for fifty — which is what
 * a list of states is. This behaves like the single select beside it: a trigger
 * that reads as a field, a popover list, a check on what is chosen. It adds the
 * two things a long list needs and a chip row cannot have: a filter box, and a
 * summary on the trigger so the choice is legible when the list is closed.
 *
 * The value stays a comma-joined string, so a filtered view is still a URL
 * somebody can paste to a colleague.
 */
export function MultiSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Any',
  searchPlaceholder = 'Filter…',
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');

  const chosen = React.useMemo(() => (value ? value.split(',').filter(Boolean) : []), [value]);
  const chosenSet = React.useMemo(() => new Set(chosen), [chosen]);

  const visible = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
    );
  }, [options, term]);

  function toggle(optionValue: string) {
    const next = chosenSet.has(optionValue)
      ? chosen.filter((entry) => entry !== optionValue)
      : [...chosen, optionValue];
    onValueChange(next.join(','));
  }

  // Names when there are few, a count when there are many — a trigger reading
  // "CA, TX, NY, FL, WA, OR, NV…" is no more useful than one reading "7".
  const summary =
    chosen.length === 0
      ? placeholder
      : chosen.length <= 3
        ? chosen
            .map((entry) => options.find((option) => option.value === entry)?.label ?? entry)
            .join(', ')
        : `${chosen.length} selected`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        // Same semantics as the single select beside it: a screen reader should
        // not have to learn a second pattern because the control happens to
        // accept more than one answer.
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'ar-input flex items-center justify-between gap-2 text-left',
          chosen.length === 0 && 'text-[var(--ar-text-faint)]',
          'data-[state=open]:border-[var(--ar-primary)] data-[state=open]:shadow-[var(--ar-ring)]',
          className,
        )}
      >
        <span className="truncate">{summary}</span>
        <span className="flex flex-none items-center gap-1">
          {chosen.length ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              className="rounded p-0.5 text-[var(--ar-text-faint)] hover:text-[var(--ar-danger)]"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onValueChange('');
              }}
            >
              <XIcon size={14} />
            </span>
          ) : null}
          <ChevronDownIcon size={16} className="text-[var(--ar-text-muted)]" />
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            'z-[60] w-[var(--radix-popover-trigger-width)] min-w-[13rem] overflow-hidden',
            'rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-white',
            'shadow-[0_5px_25px_rgba(34,48,62,0.16)]',
          )}
        >
          {options.length > 8 ? (
            <div className="flex items-center gap-2 border-b border-[var(--ar-border-soft)] px-3 py-2">
              <SearchIcon size={14} className="flex-none text-[var(--ar-text-faint)]" />
              <input
                autoFocus
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-[0.85rem] outline-none placeholder:text-[var(--ar-text-faint)]"
              />
            </div>
          ) : null}

          <ul role="listbox" aria-multiselectable className="max-h-[16rem] overflow-y-auto p-1">
            {visible.length === 0 ? (
              <li className="px-2.5 py-2 text-[0.82rem] text-[var(--ar-text-faint)]">
                Nothing matches
              </li>
            ) : (
              visible.map((option) => {
                const active = chosenSet.has(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggle(option.value)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-[var(--ar-radius-sm)]',
                        'px-2.5 py-[0.45rem] text-left text-[0.875rem] transition',
                        active
                          ? 'bg-[var(--ar-primary)] text-white'
                          : 'hover:bg-[var(--ar-primary-soft)] hover:text-[var(--ar-primary)]',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{option.label}</span>
                        {option.hint ? (
                          <span className="block truncate text-[0.72rem] opacity-70">
                            {option.hint}
                          </span>
                        ) : null}
                      </span>
                      {active ? (
                        <CheckIcon size={15} strokeWidth={2.5} className="flex-none" />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {chosen.length ? (
            <div className="flex items-center justify-between border-t border-[var(--ar-border-soft)] px-3 py-2">
              <span className="text-[0.75rem] text-[var(--ar-text-faint)]">
                {chosen.length} selected
              </span>
              <button
                type="button"
                onClick={() => onValueChange('')}
                className="text-[0.78rem] font-medium text-[var(--ar-primary)]"
              >
                Clear
              </button>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
