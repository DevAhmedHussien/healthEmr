import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A single figure inside a card.
 *
 * The quieter sibling of `Stat`: no icon well, no shadow, no link — this is
 * what a row of numbers *within* a panel looks like, where `Stat` is what a row
 * of cards *on a page* looks like. Three copies of it had grown up
 * independently, at three sizes, with the label above the number in one and
 * below it in the others.
 *
 * Label under the value, everywhere. A column of figures is scanned down the
 * numbers, and putting the label first makes the reader step over it each time.
 */
export function Figure({
  label,
  value,
  hint,
  tone = 'default',
  trailing,
}: {
  label: string;
  value: React.ReactNode;
  /** One short line under the label — a rate, a share, a caveat. */
  hint?: React.ReactNode;
  /** `accent` for the figure the panel is about; `muted` for a cost. */
  tone?: 'default' | 'accent' | 'muted';
  /** Something beside the value, e.g. a period-over-period delta. */
  trailing?: React.ReactNode;
}) {
  return (
    // `data-figure` is a contract for the browser checks: they assert on the
    // numbers, and walking the markup to find them meant every styling change
    // broke a test that had nothing to do with styling.
    <div
      data-figure={label}
      className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-3"
    >
      <div className="flex items-baseline gap-2">
        <span
          data-figure-value
          className={cn(
            'text-xl font-medium tabular-nums',
            tone === 'accent' && 'text-[var(--ar-primary)]',
            tone === 'muted' && 'text-[var(--ar-text-muted)]',
          )}
        >
          {value}
        </span>
        {trailing}
      </div>
      <span className="mt-0.5 block text-[0.78rem] text-[var(--ar-text-muted)]">{label}</span>
      {hint ? (
        <span className="block text-[0.72rem] leading-snug text-[var(--ar-text-faint)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
