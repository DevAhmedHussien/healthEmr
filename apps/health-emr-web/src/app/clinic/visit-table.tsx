'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Skeleton,
  statusTone,
} from '@/components/ui/primitives';
import { SimpleSelect } from '@/components/ui/select';
import { SearchIcon } from '@/components/ui/icons';
import { formatDateShort } from '@/lib/format';

export interface QueueRow {
  visitId: string;
  masterId: string;
  status: string;
  waitingSince: string;
  decidedAt: string | null;
  referredAt: string | null;
  reason: string | null;
  tenant: string;
  category: string;
  patient: { id: string; mrn: string; name: string; state: string };
  items: Array<{
    id: string;
    nameText: string;
    strength: string;
    quantity: string;
    decision: string;
    decisionReason: string | null;
    /** False for a line a colleague is reviewing on a shared visit. */
    mine: boolean;
  }>;
  /** True when this visit's medications are split across two clinicians. */
  shared: boolean;
}

/** How long a patient has been waiting, in the units a clinician thinks in. */
function waited(since: string): string {
  const hours = Math.floor((Date.now() - new Date(since).getTime()) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const OPEN_STATUSES = [
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'INFO_REQUESTED', label: 'Waiting on information' },
];

const DECIDED_STATUSES = [
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DENIED', label: 'Refused' },
];

/**
 * A clinician's visits — the ones waiting, or the ones already decided.
 *
 * One component for both, because they are the same rows from the same endpoint
 * with a different status filter, and two near-identical tables would drift.
 * `mode` decides which statuses are offered and which date column is worth
 * showing: a waiting visit is read by how long it has waited, a decided one by
 * when it was decided.
 */
export function VisitTable({
  mode,
  categories,
}: {
  mode: 'queue' | 'decisions';
  /** Offered as a filter. Empty hides the control rather than showing an empty one. */
  categories: Array<{ slug: string; name: string }>;
}) {
  const [search, setSearch] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [category, setCategory] = React.useState('');

  const [rows, setRows] = React.useState<QueueRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const statuses = mode === 'queue' ? OPEN_STATUSES : DECIDED_STATUSES;

  // Typing refetches, but not on every keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), 350);
    return () => clearTimeout(timer);
  }, [draft]);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);

    const params = new URLSearchParams({ limit: '50', order: mode === 'queue' ? 'asc' : 'desc' });
    if (search) params.set('search', search);
    if (category) params.set('categorySlug', category);

    if (status) params.set('status', status);
    // Decided means approved or refused. The endpoint takes one status at a
    // time, so with no filter chosen this asks for both and merges them —
    // which is still one round trip's worth of waiting, in parallel.
    const requests =
      status || mode === 'queue'
        ? [api<{ data: QueueRow[] }>(`v1/clinic/queue?${params}`)]
        : DECIDED_STATUSES.map((option) => {
            const each = new URLSearchParams(params);
            each.set('status', option.value);
            return api<{ data: QueueRow[] }>(`v1/clinic/queue?${each}`);
          });

    Promise.all(requests)
      .then((responses) => {
        if (!live) return;
        const merged = responses.flatMap((response) => response.data);
        merged.sort((a, b) =>
          mode === 'queue'
            ? new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime()
            : new Date(b.decidedAt ?? b.waitingSince).getTime() -
              new Date(a.decidedAt ?? a.waitingSince).getTime(),
        );
        setRows(merged);
      })
      .catch((caught: Error) => live && setError(caught.message));

    return () => {
      live = false;
    };
  }, [search, status, category, mode]);

  const clear = () => {
    setDraft('');
    setStatus('');
    setCategory('');
  };
  const filtered = Boolean(search || status || category);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[16rem] flex-1">
          <span className="mb-1 block text-[0.78rem] font-medium text-[var(--ar-headings)]">
            Search
          </span>
          <div className="relative">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ar-text-faint)]"
            />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Order id, surname or record number…"
              className="pl-9"
              aria-label="Search visits"
            />
          </div>
        </label>

        <label className="w-52">
          <span className="mb-1 block text-[0.78rem] font-medium text-[var(--ar-headings)]">
            Status
          </span>
          <SimpleSelect
            value={status}
            onValueChange={setStatus}
            placeholder="Any"
            clearLabel="Any"
            aria-label="Filter by status"
            options={statuses}
          />
        </label>

        {categories.length ? (
          <label className="w-52">
            <span className="mb-1 block text-[0.78rem] font-medium text-[var(--ar-headings)]">
              Treatment
            </span>
            <SimpleSelect
              value={category}
              onValueChange={setCategory}
              placeholder="Any"
              clearLabel="Any"
              aria-label="Filter by treatment"
              options={categories.map((row) => ({ value: row.slug, label: row.name }))}
            />
          </label>
        ) : null}

        {filtered ? (
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {rows === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            filtered
              ? 'Nothing matches those filters'
              : mode === 'queue'
                ? 'Nothing waiting'
                : 'No decisions yet'
          }
          hint={
            filtered
              ? 'Clear them to see everything again.'
              : mode === 'queue'
                ? 'New visits routed to you will appear here.'
                : 'Visits you approve or refuse are listed here afterwards.'
          }
        />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[var(--ar-radius)] border border-[var(--ar-border)]">
          <table className="ar-table">
            <thead className="sticky top-0 z-10">
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Order id</th>
                <th scope="col">Treatment</th>
                <th scope="col">Requested</th>
                <th scope="col">{mode === 'queue' ? 'Waiting' : 'Decided'}</th>
                <th scope="col">{mode === 'queue' ? 'Status' : 'Outcome'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.visitId}>
                  <td>
                    <Link href={`/clinic/visits/${row.visitId}`} className="font-medium">
                      {row.patient.name}
                    </Link>
                    <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                      {row.patient.mrn} · {row.patient.state} · {row.tenant}
                    </span>
                  </td>
                  <td className="tabular-nums text-[0.8rem]">{row.masterId}</td>
                  <td>{row.category}</td>
                  <td className="text-[0.82rem]">
                    {/* On a shared visit only some of these are yours to
                        decide, and the difference has to be visible before you
                        open the chart — otherwise the queue promises work that
                        is not there. */}
                    {row.shared ? (
                      <div className="flex flex-col gap-0.5">
                        {row.items.map((item) => (
                          <span
                            key={item.id}
                            className={
                              item.mine ? undefined : 'text-[var(--ar-text-muted)] line-through'
                            }
                          >
                            {item.nameText}
                          </span>
                        ))}
                      </div>
                    ) : (
                      row.items.map((item) => item.nameText).join(', ')
                    )}
                  </td>
                  <td className="tabular-nums">
                    {mode === 'queue' ? waited(row.waitingSince) : formatDateShort(row.decidedAt)}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={row.referredAt ? 'info' : statusTone(row.status)}>
                        {row.referredAt ? 'referred' : row.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                      {row.shared ? (
                        <span
                          className="text-[0.72rem] text-[var(--ar-text-muted)]"
                          title="No single clinician is credentialed for every medication on this visit, so it is being reviewed by two."
                        >
                          shared with a colleague
                        </span>
                      ) : null}
                      {/* A half-approved visit reads as "approved" on the visit
                          alone, which is not what happened. */}
                      {mode === 'decisions' && row.items.some((item) => item.decision === 'DENIED')
                        ? (() => {
                            const denied = row.items.filter((i) => i.decision === 'DENIED').length;
                            return (
                              <span className="text-[0.72rem] text-[var(--ar-text-muted)]">
                                {denied} of {row.items.length} refused
                              </span>
                            );
                          })()
                        : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows?.length ? (
        <p className="text-[0.78rem] text-[var(--ar-text-faint)]">
          {rows.length} visit{rows.length === 1 ? '' : 's'}
          {filtered ? ' matching' : ''}
        </p>
      ) : null}
    </div>
  );
}
