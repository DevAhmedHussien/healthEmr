'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { useDebouncedCallback } from 'use-debounce';
import { cn } from '@/lib/utils';
import { Button, EmptyState } from '@/components/ui/primitives';
import { useTableState } from './use-table-state';
import { useListQuery } from './use-list-query';
import { TableToolbar, filterColumn, type FilterDef } from './table-toolbar';
import { ColumnFilterRow } from './column-filter-row';
import { TablePagination } from './table-pagination';
import { RefreshIcon, XIcon } from '@/components/ui/icons';

export interface DataTableProps<T> {
  /** BFF path, without the leading slash. */
  endpoint: string;
  columns: ColumnDef<T, unknown>[];
  /** Column ids that may be sorted. Must match the API's allowlist. */
  sortable?: readonly string[];
  filters?: readonly FilterDef[];
  searchPlaceholder?: string;
  /** Shown when the dataset itself is empty, as opposed to filtered to nothing. */
  emptyTitle?: string;
  emptyHint?: string;
  onRowClick?: (row: T) => void;
  /** Bulk actions render the selection column; omit it and there is none. */
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  rowId?: (row: T) => string;
  /**
   * Column ids hidden until somebody asks for them.
   *
   * A table can hold every field a record has without showing all of them at
   * once: the columns most people need are on, the rest are one click away in
   * the Columns menu. Showing forty columns by default is the same as showing
   * none, because nothing can be read.
   */
  hiddenByDefault?: readonly string[];
  /**
   * Key under which a reader's column choices are remembered.
   *
   * Without it, turning on the three columns you actually work from is a chore
   * repeated on every visit — so people stop bothering and the data stays
   * hidden. Scoped per table, because the useful set differs by table.
   */
  storageKey?: string;
}

/**
 * One table for the whole console.
 *
 * TanStack supplies the headless model; paging, sorting and filtering all happen
 * on the server — the browser never holds the full dataset. State lives in the
 * URL so a view can be shared and survives a refresh.
 */
export function DataTable<T extends Record<string, unknown>>({
  endpoint,
  columns,
  sortable = [],
  filters = [],
  searchPlaceholder = 'Search…',
  emptyTitle = 'Nothing here yet',
  emptyHint,
  onRowClick,
  bulkActions,
  rowId,
  hiddenByDefault = [],
  storageKey,
}: DataTableProps<T>) {
  const filterKeys = React.useMemo(() => filters.map((filter) => filter.key), [filters]);
  const table$ = useTableState(filterKeys);
  const { state, push, toggleSort, setFilter, clearAll, activeFilterCount } = table$;
  const { rows, pageInfo, meta, loading, refreshing, error, refetch } = useListQuery<T>(
    endpoint,
    state,
  );

  const searchRegionId = `${React.useId()}-column-search`;

  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() =>
    Object.fromEntries(hiddenByDefault.map((id) => [id, false])),
  );

  // Restored after mount, never during render: reading localStorage while
  // rendering gives the server and the client different markup and React throws
  // the server's away.
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(`ar.columns.${storageKey}`);
      if (saved) setColumnVisibility(JSON.parse(saved) as VisibilityState);
    } catch {
      // A corrupt or blocked store is not worth failing a page over; the
      // defaults are perfectly usable.
    }
  }, [storageKey]);

  const changeVisibility = React.useCallback<React.Dispatch<React.SetStateAction<VisibilityState>>>(
    (updater) =>
      setColumnVisibility((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (storageKey) {
          try {
            window.localStorage.setItem(`ar.columns.${storageKey}`, JSON.stringify(next));
          } catch {
            // Remembering is a convenience, not a requirement.
          }
        }
        return next;
      }),
    [storageKey],
  );
  const [selection, setSelection] = React.useState<Record<string, boolean>>({});

  // Search is debounced so a keystroke does not become a request; the hook
  // cancels whatever is still in flight when the next one starts.
  const [draft, setDraft] = React.useState(state.q ?? '');
  const pushSearch = useDebouncedCallback((value: string) => push({ q: value || undefined }), 300);

  React.useEffect(() => setDraft(state.q ?? ''), [state.q]);
  // Selecting rows on page 2 that were chosen on page 1 cannot be honoured by a
  // server-paged table, so selection resets when the page does.
  React.useEffect(() => setSelection({}), [state.page, state.pageSize, state.q]);

  const getRowId = React.useCallback(
    (row: T, index: number) => rowId?.(row) ?? String((row as { id?: string }).id ?? index),
    [rowId],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: pageInfo?.totalPages ?? 0,
    state: { columnVisibility, rowSelection: selection },
    onColumnVisibilityChange: changeVisibility,
    onRowSelectionChange: setSelection,
    enableRowSelection: Boolean(bulkActions),
    getRowId,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const visibleColumnCount = visibleLeafColumns.length;

  /**
   * The per-column search strip, closed by default.
   *
   * A permanent strip of empty boxes pushes the first row of data down the
   * screen on every table in the console, and most visits to a worklist are to
   * read it rather than to search it. A view arrived at through a shared link
   * opens itself, because a filter that is narrowing the table has to be
   * visible to be understood — or undone.
   */
  const [showColumnSearch, setShowColumnSearch] = React.useState(false);
  const opened = React.useRef(false);

  React.useEffect(() => {
    if (opened.current || activeFilterCount === 0) return;
    opened.current = true;
    setShowColumnSearch(true);
  }, [activeFilterCount]);

  /**
   * A filter whose key names a column also gets a box under that column's
   * header, where the reader is already looking.
   *
   * It stays in the Filters panel as well rather than moving there. A column
   * can be switched off — most are, by default — and its filter has to remain
   * reachable when its header is not on screen. Both controls read and write
   * the same URL parameter, so they cannot disagree about what is filtered.
   */
  const columnIds = React.useMemo(
    () => new Set(table.getAllLeafColumns().map((column) => column.id)),
    [table],
  );
  const byColumn = React.useMemo(
    () =>
      new Map(
        filters
          .filter((filter) => columnIds.has(filterColumn(filter)))
          .map((filter) => [filterColumn(filter), filter]),
      ),
    [filters, columnIds],
  );

  return (
    <div className="ar-card overflow-hidden">
      <TableToolbar
        search={draft}
        onSearch={(value) => {
          setDraft(value);
          pushSearch(value);
        }}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        filterValues={state.filters}
        onFilter={setFilter}
        activeFilterCount={activeFilterCount}
        showColumnSearch={showColumnSearch}
        onToggleColumnSearch={() => setShowColumnSearch((value) => !value)}
        searchRegionId={searchRegionId}
        searchableColumns={byColumn.size}
        onRefresh={refetch}
        refreshing={refreshing || loading}
        onClear={() => {
          setDraft('');
          clearAll();
        }}
        columns={table.getAllLeafColumns().filter((column) => column.getCanHide())}
        selected={selectedRows}
        bulkActions={
          bulkActions ? (chosen) => bulkActions(chosen, () => setSelection({})) : undefined
        }
      />

      {/* Rows already on screen stay readable while a newer copy arrives; only
          a query nobody has run before draws a skeleton. `aria-busy` says so
          without the visual cue, and the dimming is slight on purpose — a hard
          flash on every revisit is the thing this replaced. */}
      <div
        aria-busy={refreshing || loading}
        className={`max-h-[70vh] overflow-auto transition-opacity ${
          refreshing && !loading ? 'opacity-60' : ''
        }`}
      >
        <table className="ar-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {bulkActions ? (
                <th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={table.getIsAllRowsSelected()}
                    ref={(element) => {
                      if (element) element.indeterminate = table.getIsSomeRowsSelected();
                    }}
                    onChange={table.getToggleAllRowsSelectedHandler()}
                  />
                </th>
              ) : null}

              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const canSort = sortable.includes(header.column.id);
                const active = state.sort === header.column.id;
                const direction = state.order === 'asc' ? 'ascending' : 'descending';
                return (
                  // aria-sort belongs on the header cell, not the control inside
                  // it — a screen reader reads sort state off the column.
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={canSort && active ? direction : undefined}
                    className={stickyClass(header.column.id, 'head')}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(header.column.id)}
                        className="inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-[var(--ar-primary)]"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span
                          aria-hidden
                          className={cn('text-[0.65rem]', active ? 'opacity-100' : 'opacity-30')}
                        >
                          {active && state.order === 'asc' ? '▲' : '▼'}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>

            {showColumnSearch && byColumn.size > 0 ? (
              <ColumnFilterRow
                id={searchRegionId}
                columns={visibleLeafColumns}
                filters={byColumn}
                values={state.filters}
                onFilter={setFilter}
                leadingCell={Boolean(bulkActions)}
              />
            ) : null}
          </thead>

          <tbody>
            {loading ? (
              // Skeleton rows match the real row height, so nothing shifts when
              // data arrives.
              Array.from({ length: Math.min(state.pageSize, 8) }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`}>
                  {Array.from({ length: visibleColumnCount + (bulkActions ? 1 : 0) }).map(
                    (__, cellIndex) => (
                      <td key={cellIndex}>
                        <div
                          className="ar-skeleton h-4"
                          style={{ width: `${55 + ((cellIndex * 13) % 35)}%` }}
                        />
                      </td>
                    ),
                  )}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={visibleColumnCount + (bulkActions ? 1 : 0)}>
                  <EmptyState
                    title="We could not load this"
                    hint={error}
                    action={
                      <Button size="sm" variant="outline" icon={RefreshIcon} onClick={refetch}>
                        Try again
                      </Button>
                    }
                  />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnCount + (bulkActions ? 1 : 0)}>
                  {/* The distinction the operator needs: an empty dataset is not
                      the same as a filter that matched nothing. */}
                  {meta?.filtered ? (
                    <EmptyState
                      title="No results"
                      hint={
                        state.q
                          ? `Nothing matched “${state.q}”. Try a different search or clear the filters.`
                          : 'Nothing matched these filters.'
                      }
                      action={
                        <Button size="sm" variant="outline" icon={XIcon} onClick={clearAll}>
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState title={emptyTitle} hint={emptyHint} />
                  )}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  /**
                   * A control inside the row belongs to itself.
                   *
                   * Without this the row's own handler runs too, because the
                   * click bubbles — so pressing a button in a cell opened its
                   * dialog *and* navigated away from the page underneath it,
                   * which unmounted the dialog a moment later. It applies to
                   * every in-row control: a selection checkbox, a link, an
                   * action button, anything added later.
                   */
                  onClick={
                    onRowClick
                      ? (event) => {
                          const target = event.target as HTMLElement | null;
                          if (target?.closest('button, a, input, select, textarea, label')) return;
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          // Enter on a focused button is that button's, not the row's.
                          const target = event.target as HTMLElement | null;
                          if (target?.closest('button, a, input, select, textarea')) return;
                          event.preventDefault();
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  className={cn(
                    onRowClick && 'cursor-pointer focus-visible:bg-[var(--ar-primary-soft)]',
                    row.getIsSelected() && 'bg-[var(--ar-primary-soft)]',
                  )}
                >
                  {bulkActions ? (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                      />
                    </td>
                  ) : null}
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={stickyClass(cell.column.id, 'body')}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageInfo && !error ? (
        <TablePagination
          pageInfo={pageInfo}
          onPage={(page) => push({ page })}
          onPageSize={(pageSize) => push({ pageSize })}
        />
      ) : null}
    </div>
  );
}

/**
 * Pins the actions column to the right edge.
 *
 * A wide table scrolls sideways, and the buttons are the reason most people
 * opened it — scrolling to the end to reach them, on every row, is the kind of
 * friction that makes an otherwise complete table feel unfinished. The cell
 * needs its own background or the columns beneath show through as it passes.
 */
function stickyClass(columnId: string, part: 'head' | 'body'): string | undefined {
  if (columnId !== 'actions') return undefined;

  const shared = 'sticky right-0 shadow-[-8px_0_8px_-8px_rgba(34,48,62,0.15)]';
  // The body cell inherits the row's background, so it keeps following the hover
  // tint. The header keeps the one `.ar-table thead th` already gives it.
  return part === 'head' ? `${shared} z-20` : `${shared} z-10 bg-inherit`;
}
