'use client';

import * as React from 'react';
import { TableWrap } from '@/components/ui/primitives';

export interface DayPoint {
  /** YYYY-MM-DD in the reported zone. */
  day: string;
  activeMinutes: number;
  sessions: number;
  decisions: number;
}

/**
 * Hours worked per day.
 *
 * Drawn rather than charted with a library: it is one series of bars, and a
 * charting dependency would be larger than the page it sits on. The parts worth
 * getting right are the axis and the empty days, and both are done here.
 *
 * Days with no activity are drawn as gaps rather than skipped. Omitting them
 * would pull the working days together and make an intermittent week look like
 * a steady one, which is the opposite of what somebody reads this to find out.
 */
export function HoursChart({
  data,
  height = 220,
  ariaLabel = 'Hours worked per day',
}: {
  data: DayPoint[];
  height?: number;
  ariaLabel?: string;
}) {
  const hours = data.map((point) => point.activeMinutes / 60);
  const peak = Math.max(...hours, 0);
  const top = niceCeiling(peak);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => top * fraction);

  if (!data.length) {
    return <p className="text-[0.9rem] text-[var(--ar-text-muted)]">Nothing recorded yet.</p>;
  }

  // Wide enough that a month of bars is still readable; the container scrolls.
  const barWidth = 26;
  const gap = 8;
  const padLeft = 44;
  const padBottom = 34;
  const padTop = 10;
  const plotWidth = data.length * (barWidth + gap);
  const width = padLeft + plotWidth + 10;
  const plotHeight = height - padBottom - padTop;

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block"
        >
          {ticks.map((tick) => {
            const y = padTop + plotHeight - (tick / top) * plotHeight;
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - 10}
                  y2={y}
                  stroke="var(--ar-border)"
                  strokeWidth="1"
                  opacity={tick === 0 ? 1 : 0.5}
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--ar-text-faint)"
                >
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}

          {data.map((point, index) => {
            const value = point.activeMinutes / 60;
            const barHeight = top ? (value / top) * plotHeight : 0;
            const x = padLeft + index * (barWidth + gap);
            const y = padTop + plotHeight - barHeight;
            const label = `${formatDay(point.day)}: ${formatHours(point.activeMinutes)}${
              point.decisions ? `, ${point.decisions} decisions` : ''
            }`;
            return (
              <g key={point.day}>
                {/* A full-height invisible bar, so the tooltip is reachable on a
                    day with almost no activity rather than a 2px target. */}
                <rect x={x} y={padTop} width={barWidth} height={plotHeight} fill="transparent">
                  <title>{label}</title>
                </rect>
                {barHeight > 0 ? (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(barHeight, 2)}
                    rx="3"
                    fill="var(--ar-primary)"
                    opacity={point.decisions ? 1 : 0.45}
                  >
                    <title>{label}</title>
                  </rect>
                ) : null}
                {/* Every other label on a long run, so they do not collide. */}
                {data.length <= 14 || index % 3 === 0 ? (
                  <text
                    x={x + barWidth / 2}
                    y={height - 14}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill="var(--ar-text-faint)"
                  >
                    {shortDay(point.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8rem] text-[var(--ar-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[var(--ar-primary)]" />
          Active time
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[var(--ar-primary)] opacity-45" />
          Signed in, nothing decided
        </span>
      </figcaption>

      {/* The same numbers as a table, for a screen reader and for anyone who
          wants to read the figures rather than compare the shapes. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[0.82rem] text-[var(--ar-text-muted)]">
          Show the figures
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <TableWrap>
            <thead>
              <tr>
                <th>Day</th>
                <th>Active</th>
                <th>Sessions</th>
                <th>Decisions</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((point) => (
                <tr key={point.day}>
                  <td className="tabular-nums">{formatDay(point.day)}</td>
                  <td className="tabular-nums">{formatHours(point.activeMinutes)}</td>
                  <td className="tabular-nums">{point.sessions || '—'}</td>
                  <td className="tabular-nums">{point.decisions || '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </details>
    </figure>
  );
}

/** `2h 05m`, or `18m` when there is no hour to show. */
export function formatHours(minutes: number): string {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

function formatTick(hours: number): string {
  if (hours === 0) return '0';
  return hours >= 1 ? `${round(hours)}h` : `${Math.round(hours * 60)}m`;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The top of the axis: four equal, round steps clearing the tallest bar.
 *
 * Rounding the ceiling alone gives ticks nobody reads — 2.5 in four parts is
 * 0.625. Rounding the step and multiplying makes every tick a number a person
 * recognises, which is the only reason to draw ticks at all.
 */
function niceCeiling(hours: number): number {
  if (hours <= 0) return 1;
  const step = hours / 4;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const normalised = step / magnitude;
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => normalised <= c) ?? 10;
  return nice * magnitude * 4;
}

/** Parsed as a plain calendar day, not as an instant to be re-zoned. */
function asDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
}

function formatDay(day: string): string {
  return asDate(day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function shortDay(day: string): string {
  return asDate(day).toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
  });
}
