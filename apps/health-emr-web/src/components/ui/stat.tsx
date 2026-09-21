import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ChevronRightIcon } from '@/components/ui/icons';

export type StatTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<StatTone, string> = {
  primary: 'bg-[var(--ar-primary-soft)] text-[var(--ar-primary)]',
  success: 'bg-[var(--ar-success-soft)] text-[var(--ar-on-success)]',
  warning: 'bg-[var(--ar-warning-soft)] text-[var(--ar-on-warning)]',
  danger: 'bg-[var(--ar-danger-soft)] text-[var(--ar-on-danger)]',
  info: 'bg-[var(--ar-info-soft)] text-[var(--ar-on-info)]',
  neutral: 'bg-[var(--ar-border-soft)] text-[var(--ar-text-muted)]',
};

/**
 * A KPI tile.
 *
 * The number is the point, so it gets the size and the tabular figures — a row
 * of these should be scannable without reading a single label. The tinted icon
 * well is the source app's signature, and it is required rather than optional:
 * a row where three tiles have a well and one does not reads as a rendering
 * bug, which is exactly how the overview looked before.
 *
 * Give it an `href` when the number is something you would want to act on. A
 * tile saying "14 applications waiting" that cannot be clicked makes the reader
 * go and find the page themselves, and they were already pointing at it.
 */
export function Stat({
  label,
  value,
  sub,
  tone = 'primary',
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: StatTone;
  /**
   * The glyph for the well. A component rather than a node, so every tile gets
   * the same optical size — and an emoji cannot be passed by accident, which is
   * how a console ends up with a different icon set per platform.
   */
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Where this number is explained in full. */
  href?: string;
}) {
  const body = (
    <>
      <span className={cn('grid h-11 w-11 flex-none place-items-center rounded-full', TONES[tone])}>
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.5rem] font-medium leading-tight tabular-nums text-[var(--ar-headings)]">
          {value}
        </span>
        <span className="block truncate text-[0.85rem] text-[var(--ar-text-muted)]">{label}</span>
        {sub ? (
          <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ar-text-faint)]">
            {sub}
          </span>
        ) : null}
      </span>
      {href ? (
        <span
          aria-hidden="true"
          className="flex-none text-[var(--ar-text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ar-primary)]"
        >
          <ChevronRightIcon size={16} />
        </span>
      ) : null}
    </>
  );

  const shell = 'ar-card flex items-center gap-4 p-5';

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      // The whole tile is the target, not just the number. A 44px-tall link in
      // the corner of a card is a miss on a touch screen.
      className={cn(shell, 'group transition-shadow hover:shadow-[var(--ar-shadow-lg)]')}
    >
      {body}
    </Link>
  );
}
