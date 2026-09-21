'use client';

import * as React from 'react';
import { Badge, EmptyState, statusTone } from '@/components/ui/primitives';
import { formatDateShort } from '@/lib/format';

export interface Licence {
  state: string;
  licenseNumber: string;
  status: string;
  expiresAt: string;
}

type Column = 'state' | 'licenseNumber' | 'expiresAt' | 'status';

const COLUMNS: Array<{ id: Column; label: string }> = [
  { id: 'state', label: 'State' },
  { id: 'licenseNumber', label: 'Number' },
  { id: 'expiresAt', label: 'Expires' },
  { id: 'status', label: 'Status' },
];

const isExpired = (licence: Licence) => new Date(licence.expiresAt) < new Date();

/**
 * A provider's state licences.
 *
 * A clinician licensed everywhere has fifty-one rows, which as a plain table
 * pushed everything below it — documents, decisions, the fee schedule — off the
 * bottom of the page. So it scrolls inside a fixed height with the header
 * pinned, and every column sorts.
 *
 * Sorted by state by default, because the question this table usually answers
 * is "do they hold one in Texas". The expiring ones are the ones that need
 * acting on, so they are counted above the table rather than relying on the
 * reader to sort and notice.
 */
export function LicenceTable({ licences }: { licences: Licence[] }) {
  const [sort, setSort] = React.useState<Column>('state');
  const [descending, setDescending] = React.useState(false);

  const rows = React.useMemo(() => {
    const sorted = [...licences].sort((a, b) => {
      if (sort === 'expiresAt') {
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      }
      // Status sorts by what needs attention, not alphabetically: "expired"
      // before "active" is the useful order, and E before A is a coincidence
      // that would break the moment a status was renamed.
      if (sort === 'status') {
        const rank = (licence: Licence) =>
          isExpired(licence) ? 0 : licence.status === 'ACTIVE' ? 2 : 1;
        return rank(a) - rank(b) || a.state.localeCompare(b.state);
      }
      return a[sort].localeCompare(b[sort]);
    });

    return descending ? sorted.reverse() : sorted;
  }, [licences, sort, descending]);

  const expired = licences.filter(isExpired).length;

  function toggle(column: Column) {
    if (column === sort) {
      setDescending((value) => !value);
      return;
    }
    setSort(column);
    setDescending(false);
  }

  if (licences.length === 0) return <EmptyState title="No licences on file" />;

  return (
    <div>
      <p className="mb-2 text-[0.8rem] text-[var(--ar-text-muted)]">
        {licences.length} on file
        {expired ? (
          <>
            {' · '}
            <strong className="text-[var(--ar-on-danger)]">{expired} expired</strong>
          </>
        ) : null}
      </p>

      {/* Capped and scrolling, with the header pinned — the same treatment the
          long console tables get. */}
      <div className="max-h-[22rem] overflow-auto rounded-[var(--ar-radius)] border border-[var(--ar-border)]">
        <table className="ar-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {COLUMNS.map((column) => {
                const active = sort === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    // On the cell, not the button: a screen reader reads sort
                    // state off the column.
                    aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column.id)}
                      className="flex items-center gap-1 text-inherit"
                    >
                      {column.label}
                      <span aria-hidden="true" className={active ? '' : 'opacity-30'}>
                        {active && descending ? '↓' : '↑'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((licence) => {
              const lapsed = isExpired(licence);
              return (
                <tr key={licence.state}>
                  <td className="font-medium">{licence.state}</td>
                  <td className="tabular-nums">{licence.licenseNumber}</td>
                  <td className="tabular-nums">{formatDateShort(licence.expiresAt)}</td>
                  <td>
                    <Badge tone={lapsed ? 'danger' : statusTone(licence.status)}>
                      {lapsed ? 'expired' : licence.status.toLowerCase()}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
