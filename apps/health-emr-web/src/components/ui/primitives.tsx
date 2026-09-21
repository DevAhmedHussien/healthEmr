import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The primitives every screen is built from, styled to the Ascend Rehab tokens.
 *
 * The defining detail is the card: no border at all, sitting on the pale blue
 * ground on shadow alone. Adding a border is the single easiest way to make this
 * stop looking like the source app.
 */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ar-card ar-card-pad', className)} {...props} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {/* `h3`, under the page's `h2`. It was an `h4`, which skipped a level
            and left a screen reader's outline with a hole in it on every page
            that has a card — which is every page. The size is unchanged; only
            the level is. */}
        <h3 className="text-[1.071rem] font-medium">{title}</h3>
        {subtitle ? (
          <p className="mt-1 max-w-[70ch] text-[0.857rem] text-[var(--ar-text-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  /**
   * Leading glyph. Pass the component, not an element — the button decides the
   * size, so every button in the console ends up with the same optical weight
   * whatever the caller was thinking about.
   */
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Trailing glyph, for buttons that move you somewhere. */
  iconAfter?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /**
   * No visible label. Requires `aria-label`, because an icon alone names
   * nothing to a screen reader.
   */
  iconOnly?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconAfter: IconAfter,
  iconOnly = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-[var(--ar-radius)] font-medium ' +
    'transition-[background-color,box-shadow,color] disabled:cursor-not-allowed disabled:opacity-60';
  const sizes = iconOnly
    ? { sm: 'h-8 w-8 text-[0.8rem]', md: 'h-10 w-10 text-[0.9rem]' }
    : {
        sm: 'px-3 py-1.5 text-[0.8rem]',
        md: 'px-[1.4rem] py-[0.593rem] text-[0.9rem]',
      };
  // 16px at 2.5 stroke inside a button is the weight the source design uses; a
  // lighter stroke disappears against a filled button.
  const glyph = { size: size === 'sm' ? 14 : 16, strokeWidth: 2.5 };
  const variants = {
    primary:
      'bg-[var(--ar-primary)] text-white shadow-[0_4px_12px_-2px_rgba(17,95,170,0.35)] ' +
      'hover:bg-[var(--ar-primary-d1)]',
    secondary: 'bg-[var(--ar-secondary)] text-white hover:brightness-95',
    outline:
      'border border-[var(--ar-primary)] text-[var(--ar-primary)] hover:bg-[var(--ar-primary-soft)]',
    ghost: 'text-[var(--ar-text-muted)] hover:bg-[var(--ar-body-bg)]',
    danger: 'bg-[var(--ar-danger)] text-white hover:brightness-95',
  };
  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...props}>
      {Icon ? <Icon {...glyph} /> : null}
      {children}
      {IconAfter ? <IconAfter {...glyph} /> : null}
    </button>
  );
}

/**
 * Vuexy badges are a tint of the semantic colour with the solid colour as text —
 * not a solid fill. That keeps a dense table readable when many rows carry one.
 */
const BADGE_TONES = {
  neutral: 'bg-[var(--ar-gray-200)] text-[var(--ar-text-muted)]',
  primary: 'bg-[var(--ar-primary-soft)] text-[var(--ar-primary)]',
  success: 'bg-[var(--ar-success-soft)] text-[var(--ar-on-success)]',
  info: 'bg-[var(--ar-info-soft)] text-[var(--ar-on-info)]',
  warning: 'bg-[var(--ar-warning-soft)] text-[var(--ar-on-warning)]',
  danger: 'bg-[var(--ar-danger-soft)] text-[var(--ar-on-danger)]',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--ar-radius-lg)] px-[0.7rem] py-[0.3rem] text-[0.75rem] font-medium leading-none',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof BADGE_TONES {
  const value = status.toUpperCase();
  if (['APPROVED', 'SHIPPED', 'DELIVERED', 'SIGNED', 'ACTIVE', 'ACCEPTED', 'PAID'].includes(value))
    return 'success';
  if (['DENIED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED', 'SUSPENDED', 'VOID'].includes(value))
    return 'danger';
  if (
    [
      'IN_REVIEW',
      'INFO_REQUESTED',
      'PENDING_ASSIGNMENT',
      'UNDER_REVIEW',
      'QUEUED',
      'PENDING',
    ].includes(value)
  )
    return 'warning';
  if (['ASSIGNED', 'SUBMITTED', 'IN_FULFILMENT', 'TRANSMITTED'].includes(value)) return 'info';
  return 'neutral';
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.857rem] font-medium text-[var(--ar-body-color)]">
        {label}
      </span>
      {children}
      {hint && !error ? (
        <span className="mt-1 block text-[0.75rem] text-[var(--ar-text-faint)]">{hint}</span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-[0.75rem] text-[var(--ar-danger)]">{error}</span>
      ) : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('ar-input', props.className)} />;
}

/**
 * An input with a glyph set inside its left edge.
 *
 * The icon is inert — `pointer-events-none` — so the whole field stays one
 * click target. Padding is added to the input rather than the icon being
 * floated over text, which would let a long value run underneath it.
 */
export function InputWithIcon({
  icon: Icon,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="relative">
      <Icon
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ar-text-muted)]"
      />
      <input {...props} className={cn('ar-input pl-9', className)} />
    </div>
  );
}

/**
 * A multi-line field.
 *
 * `whitespace-pre-wrap` is set explicitly rather than left to the browser
 * default. A textarea inherits `white-space`, and several of these are opened
 * from inside a table cell where it is `nowrap` — which makes typed text run off
 * to the right on one endless line instead of wrapping.
 *
 * The vertical padding is squarer than `.ar-input`'s, which is tuned so a single
 * line sits centred and leaves the first line of a textarea looking pushed down.
 */
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={cn(
        'ar-input min-h-24 resize-y whitespace-pre-wrap break-words py-2.5 leading-relaxed',
        props.className,
      )}
    />
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="font-medium text-[var(--ar-headings)]">{title}</p>
      {hint ? <p className="mt-1 text-[0.857rem] text-[var(--ar-text-muted)]">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'info' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const tones = {
    danger: 'bg-[var(--ar-danger-soft)] text-[var(--ar-on-danger)] border-[var(--ar-danger)]',
    info: 'bg-[var(--ar-info-soft)] text-[var(--ar-on-info)] border-[var(--ar-info)]',
    success: 'bg-[var(--ar-success-soft)] text-[var(--ar-on-success)] border-[var(--ar-success)]',
    warning: 'bg-[var(--ar-warning-soft)] text-[var(--ar-on-warning)] border-[var(--ar-warning)]',
  };
  return (
    <div
      className={cn('rounded-[var(--ar-radius)] border-l-4 px-4 py-3 text-[0.9rem]', tones[tone])}
    >
      {children}
    </div>
  );
}

/** Wide content scrolls inside its own container; the page body never does. */
export function TableWrap({
  children,
  fixed = false,
}: {
  children: React.ReactNode;
  /**
   * Widths come from a `<colgroup>` rather than from the content.
   *
   * Auto layout sizes a table to its longest cell, so one 32-character product
   * code decides how wide the whole thing is. With a fixed grid the table is
   * always exactly as wide as the space it has, and the long cell ellipses
   * instead — which is what the one-line row style already expects. Only worth
   * it where the content is unpredictably long; a table of dates and counts is
   * better left to size itself.
   */
  fixed?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('ar-table', fixed && 'table-fixed')}>{children}</table>
    </div>
  );
}

/** Skeleton sized to match the row it stands in for, so nothing shifts. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('ar-skeleton h-4 w-full', className)} />;
}
