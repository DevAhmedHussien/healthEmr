'use client';

import * as React from 'react';
import { formatMoney } from '@/lib/format';
import { api } from '@/lib/api';

export interface Segment {
  key: string;
  label: string;
  /** Integer cents. */
  value: number;
  color: string;
}

export interface Column {
  /** Bucket start, ISO date. */
  period: string;
  label: string;
  segments: Segment[];
}

/**
 * Rounds a peak up to a number a person would choose for the top of an axis.
 *
 * A y-axis topping out at $2,165.50 makes the reader do arithmetic to place a
 * bar; one topping out at $2,500 with ticks every $625 does not.
 *
 * The steps are deliberately finer than the usual 1/2/5. On 1/2/5 a peak of
 * $2,166 rounds up to $5,000, and the tallest bar on the chart then reaches
 * only two fifths of the way up — the reader reads "a quiet period" off what is
 * actually the busiest one on record.
 */
const AXIS_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The nearest round number at or above `value`. */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  return (AXIS_STEPS.find((candidate) => normalised <= candidate) ?? 10) * magnitude;
}

/**
 * The top of the axis: four equal, round steps that clear the tallest bar.
 *
 * Rounding the *ceiling* is not enough — $2,500 in four parts gives ticks at
 * $1,875 and $625, which nobody reads off a chart. Rounding the *step* and
 * multiplying by four makes every tick a round number, which is what the ticks
 * are for.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  return niceStep(value / 4) * 4;
}

/**
 * Drops empty periods from the front of the series.
 *
 * Twelve monthly buckets against a business two months old is one bar pinned to
 * the right-hand edge and eleven columns of nothing — a chart that spends most
 * of its width proving there was no data before the company existed. The window
 * starts where the money starts, keeping a couple of empty buckets in front so
 * the first real bar is not flush against the axis.
 *
 * Only leading buckets. A gap in the middle is information, and a quiet month
 * at the end is the most important thing on the chart.
 */
function trimLeadingEmpty(
  columns: Column[],
  totals: number[],
): { columns: Column[]; totals: number[]; dropped: number } {
  const first = totals.findIndex((total) => total > 0);
  if (first <= 0) return { columns, totals, dropped: 0 };

  const from = Math.max(0, first - 2);
  if (from === 0) return { columns, totals, dropped: 0 };

  return { columns: columns.slice(from), totals: totals.slice(from), dropped: from };
}

/**
 * Money over time, as stacked bars.
 *
 * Stacked rather than grouped because the relationship is additive: cost plus
 * fees plus profit is revenue, and a stack shows that as the shape of the bar
 * instead of asking the reader to mentally subtract two neighbours.
 *
 * It carries a labelled y-axis and gridlines, which a bar chart about money has
 * to: without a scale a bar says only "more than that one", and the question
 * being asked here is how much.
 *
 * Hand-drawn rather than a charting library. It inherits the app's own tokens,
 * it has no opinion about hydration, and it costs nothing in the bundle — three
 * problems a library would have brought with it for a bar chart.
 */
export function MoneyChart({
  columns,
  height = 200,
  emptyLabel = 'Nothing in this period yet.',
}: {
  columns: Column[];
  height?: number;
  emptyLabel?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);

  const allTotals = React.useMemo(
    () =>
      columns.map((column) =>
        column.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0),
      ),
    [columns],
  );

  const window = React.useMemo(() => trimLeadingEmpty(columns, allTotals), [columns, allTotals]);
  const shown = window.columns;
  const totals = window.totals;

  const peak = Math.max(...totals, 1);
  const everything = totals.reduce((sum, value) => sum + value, 0);
  /** The top of the axis, and the four ticks under it. */
  const ceiling = niceCeiling(peak);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((fraction) => fraction * ceiling);

  if (everything === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--ar-radius)] border border-dashed border-[var(--ar-border)] text-[0.85rem] text-[var(--ar-text-faint)]"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  // Every third label on a dense axis. Thirty overlapping dates is not an axis,
  // it is a smudge.
  const labelEvery = shown.length > 16 ? Math.ceil(shown.length / 8) : 1;

  return (
    <div>
      <div className="flex" style={{ height }}>
        {/* The scale. Without it a bar is only taller than its neighbour. */}
        <div
          aria-hidden="true"
          className="flex w-14 flex-none flex-col justify-between pr-2 text-right text-[0.65rem] leading-none text-[var(--ar-text-faint)] tabular-nums"
        >
          {ticks.map((tick) => (
            <span key={tick}>{compactMoney(tick)}</span>
          ))}
        </div>

        <div className="relative flex-1" role="img" aria-label={describe(shown, totals)}>
          {/* Gridlines behind the bars, and a solid baseline under them. */}
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick, index) => (
              <span
                key={tick}
                className="block w-full border-t"
                style={{
                  borderColor:
                    index === ticks.length - 1 ? 'var(--ar-gray-300)' : 'var(--ar-border-soft)',
                }}
              />
            ))}
          </div>

          <div className="relative flex h-full items-end gap-[3px]">
            {shown.map((column, index) => {
              const total = totals[index];
              const active = hover === index;

              return (
                <button
                  type="button"
                  key={column.period}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  // A bar is the only way to read an exact figure here, so it has to
                  // be reachable by keyboard, not hover alone.
                  aria-label={`${column.label}: ${formatMoney(total)}`}
                  className="group relative flex flex-1 flex-col justify-end rounded-t-[3px] outline-none"
                  style={{ height: '100%' }}
                >
                  {/* The bar is capped inside its slot rather than the slot
                      being narrowed. Narrowing the slot would centre three bars
                      across the full width and leave every one of them sitting
                      under the wrong x-axis label. */}
                  <span
                    className="mx-auto flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-[height,opacity]"
                    style={{
                      height: `${Math.max((total / ceiling) * 100, total > 0 ? 1.5 : 0)}%`,
                      maxWidth: shown.length < 8 ? '5.5rem' : undefined,
                      opacity: hover === null || active ? 1 : 0.45,
                    }}
                  >
                    {column.segments
                      .filter((segment) => segment.value > 0)
                      .map((segment) => (
                        <span
                          key={segment.key}
                          className="w-full"
                          style={{
                            height: `${(segment.value / total) * 100}%`,
                            background: segment.color,
                          }}
                        />
                      ))}
                  </span>

                  {active ? (
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-[var(--ar-radius)] bg-[var(--ar-headings)] px-3 py-2 text-left text-[0.72rem] leading-snug text-white shadow-lg">
                      <span className="block font-semibold">{column.label}</span>
                      {column.segments.map((segment) => (
                        <span key={segment.key} className="mt-0.5 flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                            style={{ background: segment.color }}
                          />
                          {segment.label}
                          <span className="ml-auto pl-3 tabular-nums">
                            {formatMoney(segment.value)}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 flex gap-[3px] pl-14">
        {shown.map((column, index) => (
          <span
            key={column.period}
            className="flex-1 truncate text-center text-[0.65rem] text-[var(--ar-text-faint)]"
          >
            {index % labelEvery === 0 ? column.label : ''}
          </span>
        ))}
      </div>

      {window.dropped > 0 ? (
        <p className="mt-1 pl-14 text-[0.68rem] text-[var(--ar-text-faint)]">
          {window.dropped} earlier {window.dropped === 1 ? 'period' : 'periods'} had no activity and
          are not shown.
        </p>
      ) : null}
    </div>
  );
}

/**
 * `$2.5k` rather than `$2,500.00`, for an axis tick.
 *
 * Five ticks at full precision is more digits than the bars they are measuring.
 * The exact figures are a hover away and in the totals above the chart.
 */
function compactMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return '$0';
  if (Math.abs(dollars) >= 1000) {
    const thousands = dollars / 1000;
    return `$${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}k`;
  }
  return `$${Math.round(dollars)}`;
}

/** The legend, kept next to the chart it describes rather than inside it. */
export function ChartLegend({ segments }: { segments: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {segments.map((segment) => (
        <span
          key={segment.label}
          className="flex items-center gap-1.5 text-[0.75rem] text-[var(--ar-text-muted)]"
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: segment.color }}
          />
          {segment.label}
        </span>
      ))}
    </div>
  );
}

/**
 * What the chart says, for a reader who cannot see it.
 *
 * A bar chart with no text alternative is a decorative rectangle to a screen
 * reader; the individual bars are reachable, but the shape of the whole is the
 * thing being communicated.
 */
function describe(columns: Column[], totals: number[]): string {
  const first = columns[0]?.label;
  const last = columns[columns.length - 1]?.label;
  const peak = Math.max(...totals);
  const peakAt = columns[totals.indexOf(peak)]?.label;
  const sum = totals.reduce((total, value) => total + value, 0);

  return `${formatMoney(sum)} from ${first} to ${last}. Highest was ${formatMoney(peak)} in ${peakAt}.`;
}

export const CHART_COLORS = {
  profit: 'var(--ar-primary)',
  cost: '#9FC3E4',
  fees: '#D5E4F2',
  spend: 'var(--ar-primary)',
} as const;

// ── shared series plumbing ───────────────────────────────────────────────────

export type Grain = 'day' | 'week' | 'month';

const GRAINS: Array<{ value: Grain; label: string }> = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Last 3 months' },
  { value: 'month', label: 'Monthly' },
];

/** The period picker. One control, so both charts behave identically. */
export function GrainToggle({
  grain,
  onChange,
}: {
  grain: Grain;
  onChange: (grain: Grain) => void;
}) {
  return (
    <div className="flex rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-0.5">
      {GRAINS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={grain === option.value}
          className={[
            'rounded-[calc(var(--ar-radius)-2px)] px-3 py-1 text-[0.78rem] font-medium transition-colors',
            grain === option.value
              ? 'bg-[var(--ar-primary)] text-white'
              : 'text-[var(--ar-text-muted)] hover:bg-[var(--ar-body-bg)]',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Axis labels, formatted from the ISO parts rather than through `Date`.
 *
 * A bucket is a calendar period, not an instant. Parsing "2026-09-01" into a
 * Date and reading it back in the browser's zone moves it to August for anybody
 * west of UTC, and the chart then disagrees with the total above it.
 */
export function bucketLabel(period: string, grain: Grain): string {
  const [year, month, day] = period.split('-').map(Number);

  // Month buckets keep a month name. `09-26` on an axis reads as the 26th of
  // September at least as readily as September 2026, and an axis label that has
  // to be puzzled out is worse than one that breaks the house date format.
  if (grain === 'month') return `${MONTHS[month - 1]} ${String(year).slice(2)}`;

  // Day buckets follow the console's MM-DD-YYYY, minus the year the axis has
  // already established.
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Loads one bucketed series and reloads when the grain changes.
 *
 * The grain is refetched rather than resliced from a single download: a day of
 * buckets and a year of buckets are different queries, and asking the database
 * to aggregate beats shipping a year of rows to do it here.
 */
export function useSeries<T>(endpoint: string, grain: Grain) {
  const [data, setData] = React.useState<T[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setData(null);
    setError(null);

    api<T[]>(`${endpoint}?grain=${grain}`)
      .then((rows) => live && setData(rows))
      .catch((caught: Error) => live && setError(caught.message));

    // Cancels the write, not the request: a slow answer to a grain the user has
    // already moved away from must not overwrite the one they are looking at.
    return () => {
      live = false;
    };
  }, [endpoint, grain]);

  return { data, error };
}
