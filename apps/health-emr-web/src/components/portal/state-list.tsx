'use client';

import { US_STATES } from '@health-emr/types';
import { Badge } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * A set of states, in a cell that has to stay one line tall.
 *
 * A clinician licensed nationwide has fifty-one of these. Rendering them all as
 * chips turns one table row a thousand pixels tall and buries every row after
 * it, so past a handful this summarises and puts the full list in a tooltip.
 *
 * Nationwide gets its own label rather than "51 states": a reader scanning for
 * coverage wants the answer, not a number they have to recognise.
 */
export function StateList({ states, show = 4 }: { states: string[]; show?: number }) {
  if (states.length === 0) return <span className="text-[var(--ar-text-faint)]">—</span>;

  const all = states.join(', ');

  if (states.length === US_STATES.length) {
    return (
      <Tooltip content={all}>
        <Badge tone="success">all {states.length} states</Badge>
      </Tooltip>
    );
  }

  if (states.length <= show) {
    return (
      <span className="inline-flex gap-1">
        {states.map((state) => (
          <Badge key={state} tone="primary">
            {state}
          </Badge>
        ))}
      </span>
    );
  }

  return (
    <Tooltip content={all}>
      <span className="inline-flex items-center gap-1">
        {states.slice(0, show).map((state) => (
          <Badge key={state} tone="primary">
            {state}
          </Badge>
        ))}
        <span className="whitespace-nowrap text-[0.75rem] text-[var(--ar-text-muted)]">
          +{states.length - show} more
        </span>
      </span>
    </Tooltip>
  );
}
