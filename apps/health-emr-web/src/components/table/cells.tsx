'use client';

import * as React from 'react';
import { Badge, statusTone } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { formatDateShort, formatMoney, formatNumber, formatPhone } from '@/lib/format';

/**
 * The cell shapes every console table is built from.
 *
 * Tables across five roles were each inventing their own markup for the same
 * four or five ideas — a value with a quieter second line, a number that has to
 * align, a date, a status. Written once, they read the same everywhere and a
 * change to how money looks happens in one place.
 *
 * Rows are one line tall (`.ar-table tbody td` sets `nowrap` and clips), so
 * anything that can be long is wrapped in a tooltip rather than allowed to push
 * the table sideways.
 */

/** Nothing here. An em-dash, never an empty cell — blank reads as unloaded. */
export function Empty({ label = '—' }: { label?: string }) {
  return <span className="text-[var(--ar-text-faint)]">{label}</span>;
}

/**
 * A value with a quieter line beneath it.
 *
 * The second line renders inline with a `·` separator (see `globals.css`), so
 * this stays one row tall while carrying two facts.
 */
export function Stacked({
  primary,
  secondary,
  strong = true,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** Off when the primary value is not the row's subject. */
  strong?: boolean;
}) {
  if (primary === null || primary === undefined || primary === '') return <Empty />;

  return (
    <div>
      <span className={strong ? 'font-medium text-[var(--ar-headings)]' : undefined}>
        {primary}
      </span>
      {secondary ? (
        <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">{secondary}</span>
      ) : null}
    </div>
  );
}

/** A figure that has to line up with the ones above and below it. */
export function Num({ value }: { value: number | string | null | undefined }) {
  if (value === null || value === undefined || value === '') return <Empty />;
  return (
    <span className="tabular-nums">{typeof value === 'number' ? formatNumber(value) : value}</span>
  );
}

export function Money({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return <Empty />;
  return <span className="tabular-nums">{formatMoney(cents)}</span>;
}

export function When({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <Empty />;
  return <span className="whitespace-nowrap tabular-nums">{formatDateShort(value)}</span>;
}

export function Phone({ value }: { value: string | null | undefined }) {
  if (!value) return <Empty />;
  return <span className="tabular-nums">{formatPhone(value)}</span>;
}

/** An address or free text that will not fit. Readable in full on hover. */
export function Long({ value }: { value: string | null | undefined }) {
  if (!value) return <Empty />;
  return <Tooltip content={value}>{value}</Tooltip>;
}

/** An email, which is long, frequently truncated, and worth copying whole. */
export function Email({ value }: { value: string | null | undefined }) {
  if (!value) return <Empty />;
  return (
    <Tooltip content={value}>
      <span className="text-[var(--ar-body-color)]">{value}</span>
    </Tooltip>
  );
}

/** A status, coloured by what it means rather than by where it came from. */
export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return <Empty />;
  return <Badge tone={statusTone(value)}>{value.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

/** A carrier and its tracking number, or nothing at all. */
export function Tracking({
  carrier,
  trackingNumber,
}: {
  carrier: string | null | undefined;
  trackingNumber: string | null | undefined;
}) {
  if (!trackingNumber) return <Empty label="not shipped" />;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {carrier ? `${carrier} ` : ''}
      {trackingNumber}
    </span>
  );
}

/**
 * A count that means something when it is zero.
 *
 * Allergies and errors are the cases: "0" and "—" say the same thing here, but a
 * non-zero one should catch the eye rather than sit in the same grey as
 * everything else.
 */
export function Flag({ count, tone = 'warning' }: { count: number; tone?: 'warning' | 'danger' }) {
  if (!count) return <Empty />;
  return <Badge tone={tone}>{formatNumber(count)}</Badge>;
}
