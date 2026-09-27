'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { SimpleSelect } from '@/components/ui/select';
import { Stat } from '@/components/ui/stat';
import {
  CalendarIcon,
  CheckCircleIcon,
  PulseIcon,
  TrendingUpIcon,
} from '@/components/ui/icons';
import { HoursChart, formatHours, type DayPoint } from './hours-chart';

interface Activity {
  name?: string;
  timeZone: string;
  days: number;
  series: DayPoint[];
  totals: {
    activeMinutes: number;
    activeHours: number;
    workedDays: number;
    averageMinutesPerWorkedDay: number;
    decisions: number;
    minutesPerDecision: number | null;
  };
  basis: { idleGapMinutes: number; tailMinutes: number; note: string };
}

const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * Hours worked, for one person.
 *
 * Used by a clinician looking at their own week and by the platform looking at
 * somebody else's — the same numbers either way, because two versions of "how
 * long did they work" is how the two sides end up disagreeing about it.
 */
export function ActivityPanel({
  path,
  title,
  subtitle,
}: {
  /** The endpoint to read, without the day window. */
  path: string;
  title: string;
  subtitle?: string;
}) {
  const [days, setDays] = React.useState('30');
  const [activity, setActivity] = React.useState<Activity | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);

    // The browser knows the reader's zone; the server should not have to guess
    // which calendar day an evening's work belongs to.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const separator = path.includes('?') ? '&' : '?';

    api<Activity>(`${path}${separator}days=${days}&timeZone=${encodeURIComponent(timeZone)}`)
      .then((result) => {
        if (live) setActivity(result);
      })
      .catch(() => {
        if (live) setError('We could not load this.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [path, days]);

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <SimpleSelect
            aria-label="Period"
            value={days}
            onValueChange={setDays}
            options={WINDOWS}
          />
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && !activity ? (
        <div className="space-y-3">
          <div className="ar-skeleton h-20" />
          <div className="ar-skeleton h-48" />
        </div>
      ) : activity ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={PulseIcon} label="Active time" value={formatHours(activity.totals.activeMinutes)} />
            <Stat icon={CalendarIcon} label="Days worked" value={String(activity.totals.workedDays)} />
            <Stat
              icon={TrendingUpIcon}
              label="Average per day worked"
              value={formatHours(activity.totals.averageMinutesPerWorkedDay)}
            />
            <Stat
              icon={CheckCircleIcon}
              label="Per decision"
              value={
                activity.totals.minutesPerDecision === null
                  ? '—'
                  : `${activity.totals.minutesPerDecision}m`
              }
            />
          </div>

          <div className="mt-6">
            <HoursChart
              data={activity.series}
              ariaLabel={`Hours worked per day over the last ${activity.days} days`}
            />
          </div>

          {/* Said on screen, not just in the API. A number presented without its
              basis gets quoted in a payroll conversation as if it were a clock. */}
          <p className="mt-5 border-t border-[var(--ar-border-soft)] pt-4 text-[0.8rem] text-[var(--ar-text-muted)]">
            Worked out from recorded actions rather than from a session timer, so an idle
            browser counts for nothing. A gap of more than {activity.basis.idleGapMinutes} minutes
            ends a session. Days are {activity.timeZone.replace(/_/g, ' ')}.
          </p>
        </>
      ) : null}
    </Card>
  );
}
