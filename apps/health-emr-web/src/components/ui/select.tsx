'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDownIcon } from './icons';

/**
 * The select, on Radix.
 *
 * A native `<select>` renders its list with the operating system, which is why
 * it never matches the rest of a design and cannot show a check, a hint line or
 * a disabled reason. This is the shadcn composition over Radix, dressed in the
 * AscendRehab select styling: the trigger is an `ar-input` so it lines up
 * exactly with the text fields beside it, a focused trigger takes the primary
 * border, a highlighted option takes a 12% primary tint, and the chosen option
 * is filled with the solid primary — which is what the source design does.
 *
 * Radix keeps the keyboard and screen-reader behaviour a native select has and
 * a div-with-handlers does not: type-ahead, arrow keys, Home/End, Escape, and
 * the listbox roles.
 */

/**
 * The Radix primitives, deliberately module-private.
 *
 * `SimpleSelect` below is the only select this console has. When these were
 * exported, nothing used them — but the door was open for a page to assemble
 * its own dropdown with different padding, a different empty state and no
 * clear row, which is exactly how a console ends up with four selects that
 * behave like four different products.
 */
const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { invalid?: boolean }
>(({ className, children, invalid, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'ar-input flex items-center justify-between gap-2 text-left',
      'data-[placeholder]:text-[var(--ar-text-faint)]',
      'disabled:cursor-not-allowed disabled:bg-[var(--ar-gray-100)] disabled:opacity-70',
      // Radix sets this while the list is open; keeping the focus ring on means
      // the field still reads as the active one with focus inside the popover.
      'data-[state=open]:border-[var(--ar-primary)] data-[state=open]:shadow-[var(--ar-ring)]',
      invalid && 'border-[var(--ar-danger)] focus:border-[var(--ar-danger)]',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDownIcon
        size={16}
        className="flex-none text-[var(--ar-text-muted)] transition-transform duration-150 data-[state=open]:rotate-180"
      />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={4}
      className={cn(
        'relative z-[60] max-h-[19rem] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
        'rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-white',
        'shadow-[0_5px_25px_rgba(34,48,62,0.16)]',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-[19rem] overflow-y-auto p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { hint?: string }
>(({ className, children, hint, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center justify-between gap-3',
      'rounded-[var(--ar-radius-sm)] px-2.5 py-[0.45rem] text-[0.875rem] outline-none',
      // Vuexy: hovered option is a 12% tint of the primary, chosen option is
      // the solid primary. Both, so the difference stays visible.
      'data-[highlighted]:bg-[var(--ar-primary-soft)] data-[highlighted]:text-[var(--ar-primary)]',
      'data-[state=checked]:bg-[var(--ar-primary)] data-[state=checked]:text-white',
      'data-[state=checked]:data-[highlighted]:bg-[var(--ar-primary)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="min-w-0">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint ? (
        <span className="mt-0.5 block truncate text-[0.72rem] opacity-70">{hint}</span>
      ) : null}
    </span>
    <SelectPrimitive.ItemIndicator className="flex-none">
      <CheckIcon size={15} strokeWidth={2.5} />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-[var(--ar-border-soft)]', className)}
    {...props}
  />
));
SelectSeparator.displayName = 'SelectSeparator';

/**
 * The common case, in one component.
 *
 * Most selects in the console are "a label, a list of options, a value" — this
 * saves assembling six primitives for that and keeps them consistent. Reach for
 * the parts above when you need groups, separators or custom rows.
 */
/**
 * Radix refuses an item whose value is the empty string, because it reserves ''
 * to mean "nothing chosen". Filters legitimately need a row that clears them, so
 * that row carries a sentinel here and is translated back at the boundary — the
 * URL and every caller still speak in empty strings.
 */
const CLEARED = '__cleared__';

export function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Choose one',
  /** Adds a row that clears the selection, e.g. "Any" on a filter. */
  clearLabel,
  disabled,
  invalid,
  className,
  name,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>;
  placeholder?: string;
  clearLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  name?: string;
  'aria-label'?: string;
}) {
  return (
    <Select
      value={value === '' ? (clearLabel ? CLEARED : undefined) : value}
      onValueChange={(next) => onValueChange(next === CLEARED ? '' : next)}
      disabled={disabled}
      name={name}
    >
      <SelectTrigger className={className} invalid={invalid} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {clearLabel ? (
          <>
            <SelectItem value={CLEARED}>{clearLabel}</SelectItem>
            {options.length ? <SelectSeparator /> : null}
          </>
        ) : null}
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            hint={option.hint}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
