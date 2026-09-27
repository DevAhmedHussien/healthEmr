'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Alert, Badge, Card, CardHeader, EmptyState, TableWrap } from '@/components/ui/primitives';
import { SimpleSelect } from '@/components/ui/select';
import { Stat } from '@/components/ui/stat';
import { CalendarIcon, CheckCircleIcon, PulseIcon, UsersIcon } from '@/components/ui/icons';
import { HoursChart, formatHours, type DayPoint } from '@/components/charts/hours-chart';

interface RosterRow {
  providerId: string;
  name: string;
  email: string;
  activeMinutes: number;
  activeHours: number;
  sessions: number;
  decisions: number;
  workedDays: number;
  averageMinutesPerWorkedDay: number;
  lastSeen: string | null;
}

interface Detail {
  name?: string;
  timeZone: string;
  series: DayPoint[];
  totals: { activeMinutes: number; workedDays: number; decisions: number };
}

const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * Who is actually working, and how much.
 *
 * The roster and one clinician's chart on one screen, because the question is
 * never just "how many hours" — it is "how many hours, compared with everyone
 * else". Choosing a row draws that person below without leaving the page.
 */
export function ActivityRoster() {
  const [days, setDays] = React.useState('30');
  const [rows, setRows] = React.useState<RosterRow[] | null>(null);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const timeZone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    api<{ data: RosterRow[] }>(
      `v1/super-admin/activity/providers?days=${days}&timeZone=${encodeURIComponent(timeZone)}`,
    )
      .then((result) => {
        if (!live) return;
        setRows(result.data);
        // Open on the busiest clinician rather than on nothing: an empty chart
        // below a populated table reads as broken.
        setChosen((current) => current ?? result.data[0]?.providerId ?? null);
      })
      .catch(() => live && setError('We could not load the roster.'));
    return () => {
      live = false;
    };
  }, [days, timeZone]);

  React.useEffect(() => {
    if (!chosen) return;
    let live = true;
    setDetail(null);
    api<Detail>(
      `v1/super-admin/providers/${chosen}/activity?days=${days}&timeZone=${encodeURIComponent(timeZone)}`,
    )
      .then((result) => live && setDetail(result))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chosen, days, timeZone]);

  const totals = React.useMemo(() => {
    if (!rows) return null;
    return {
      minutes: rows.reduce((sum, row) => sum + row.activeMinutes, 0),
      decisions: rows.reduce((sum, row) => sum + row.decisions, 0),
      working: rows.filter((row) => row.activeMinutes > 0).length,
      days: Math.max(...rows.map((row) => row.workedDays), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Time worked across the roster"
          subtitle="Derived from recorded actions, so a browser left open counts for nothing."
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

        {totals ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={PulseIcon} label="Total active time" value={formatHours(totals.minutes)} />
            <Stat icon={UsersIcon} label="Clinicians working" value={String(totals.working)} />
            <Stat icon={CheckCircleIcon} label="Decisions made" value={String(totals.decisions)} />
            <Stat
              icon={CalendarIcon}
              label="Busiest clinician"
              value={rows?.[0] ? formatHours(rows[0].activeMinutes) : '—'}
              sub={rows?.[0]?.name}
            />
          </div>
        ) : (
          <div className="ar-skeleton h-20" />
        )}

        <div className="mt-6">
          {!rows ? (
            <div className="ar-skeleton h-44" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing recorded in this period"
              hint="No clinician took an action in the window you chose."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>Clinician</th>
                  <th>Active time</th>
                  <th>Days worked</th>
                  <th>Average per day</th>
                  <th>Sessions</th>
                  <th>Decisions</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.providerId}
                    onClick={() => setChosen(row.providerId)}
                    className={
                      chosen === row.providerId
                        ? 'cursor-pointer bg-[var(--ar-primary-soft)]'
                        : 'cursor-pointer'
                    }
                  >
                    <td>
                      <Link
                        href={`/super-admin/providers/${row.providerId}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="block text-[0.8rem] text-[var(--ar-text-muted)]">
                        {row.email}
                      </span>
                    </td>
                    <td className="tabular-nums">{formatHours(row.activeMinutes)}</td>
                    <td className="tabular-nums">{row.workedDays}</td>
                    <td className="tabular-nums">{formatHours(row.averageMinutesPerWorkedDay)}</td>
                    <td className="tabular-nums">{row.sessions}</td>
                    <td className="tabular-nums">{row.decisions}</td>
                    <td className="tabular-nums">
                      {row.lastSeen ? <Ago at={row.lastSeen} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={detail?.name ? `${detail.name}, day by day` : 'Day by day'}
          subtitle="Choose a clinician above to see their pattern."
        />
        {detail ? (
          <HoursChart
            data={detail.series}
            ariaLabel={`Hours worked per day by ${detail.name ?? 'the selected clinician'}`}
          />
        ) : (
          <div className="ar-skeleton h-52" />
        )}
      </Card>
    </div>
  );
}

/** How long ago, in the units somebody scanning a list actually reads. */
function Ago({ at }: { at: string }) {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (minutes < 60) {
    return <Badge tone={minutes < 15 ? 'success' : 'neutral'}>{minutes}m ago</Badge>;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) return <span>{hours}h ago</span>;
  return <span>{Math.round(hours / 24)}d ago</span>;
}
