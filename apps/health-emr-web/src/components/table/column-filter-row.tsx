'use client';

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { useDebouncedCallback } from 'use-debounce';
import { SimpleSelect } from '@/components/ui/select';
import type { FilterDef } from './table-toolbar';

/**
 * A filter box under each column header.
 *
 * Filtering happens on the server: a table here is one page of a much larger
 * set, so narrowing the rows already on screen would search a fraction of the
 * data and confidently report nothing found. Each box writes its column's own
 * query parameter, the endpoint declares which columns it will accept, and
 * anything else is refused.
 *
 * Only columns the endpoint can filter get a box. An input that looked the same
 * as the others and silently did nothing would be worse than no input at all.
 *
 * Hidden until the reader asks for it. A permanent strip of empty boxes costs
 * every table a row of vertical space for a job most visits do not involve.
 */
export function ColumnFilterRow<TRow>({
  id,
  columns,
  filters,
  values,
  onFilter,
  leadingCell,
}: {
  /** So the button that reveals this row can say what it controls. */
  id: string;
  columns: Column<TRow, unknown>[];
  /** Keyed by column id; filters with no matching column belong in the toolbar. */
  filters: Map<string, FilterDef>;
  values: Record<string, string>;
  onFilter: (key: string, value: string | undefined) => void;
  /** Renders a spacer for the selection checkbox column, when there is one. */
  leadingCell: boolean;
}) {
  return (
    <tr id={id} className="ar-filter-row">
      {leadingCell ? <th className="w-10" /> : null}
      {columns.map((column) => {
        const filter = filters.get(column.id);
        return (
          <th key={column.id} className="px-3 pb-2 pt-0 font-normal">
            {filter ? (
              <FilterCell
                filter={filter}
                value={values[filter.key] ?? ''}
                onChange={(next) => onFilter(filter.key, next || undefined)}
                label={headerText(column) ?? filter.label}
              />
            ) : (
              /* Deliberately empty, and visibly so. These columns are worked
                 out per page — a running total, an average, a rendered
                 sentence — rather than read from a field, so there is nothing
                 for a database filter to match. An empty gap here reads as an
                 oversight; a dash that explains itself does not. */
              <span
                aria-hidden
                title="This column is calculated for the page, so it cannot be filtered."
                className="block select-none text-center text-[var(--ar-text-muted)] opacity-45"
              >
                —
              </span>
            )}
          </th>
        );
      })}
    </tr>
  );
}

function headerText<TRow>(column: Column<TRow, unknown>): string | undefined {
  const header = column.columnDef.header;
  return typeof header === 'string' ? header : undefined;
}

const CONTROL =
  'w-full rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-card-bg)] ' +
  'px-2 py-1 text-[0.78rem] font-normal normal-case tracking-normal text-[var(--ar-body-color)] ' +
  'placeholder:text-[var(--ar-text-muted)] focus:border-[var(--ar-primary)] focus:outline-none ' +
  'focus:ring-2 focus:ring-[var(--ar-primary)]/20';

function FilterCell({
  filter,
  value,
  onChange,
  label,
}: {
  filter: FilterDef;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  // Typed characters are held locally and pushed on a delay, so a five-letter
  // surname is one request rather than five. The URL stays the source of truth:
  // when it changes underneath us — a cleared filter, the back button — the box
  // follows it.
  const [draft, setDraft] = React.useState(value);
  const push = useDebouncedCallback(onChange, 300);
  React.useEffect(() => setDraft(value), [value]);

  if (filter.type === 'select' || filter.type === 'multi') {
    // Rendered as a single choice inline. Multi-select needs room to show what
    // is chosen, which a header cell does not have; it stays in the Filters
    // panel where it can breathe.
    return (
      <SimpleSelect
        aria-label={`Filter by ${label}`}
        className={CONTROL}
        value={value}
        onValueChange={onChange}
        placeholder="All"
        clearLabel="All"
        options={filter.options.map((option) => ({ ...option }))}
      />
    );
  }

  return (
    <input
      // `search` rather than `text` so the browser offers its own clear button.
      type={filter.type === 'dateRange' ? 'text' : 'search'}
      className={CONTROL}
      aria-label={`Filter by ${label}`}
      placeholder={filter.type === 'dateRange' ? 'yyyy-mm-dd' : 'Filter…'}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        push(event.target.value);
      }}
      // Enter applies immediately rather than waiting out the delay.
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        push.cancel();
        onChange(draft);
      }}
    />
  );
}
