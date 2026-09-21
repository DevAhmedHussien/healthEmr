'use client';

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { Button, Input, InputWithIcon } from '@/components/ui/primitives';
import { DateField } from '@/components/ui/date-field';
import {
  ChevronDownIcon,
  ColumnsIcon,
  FilterIcon,
  RefreshIcon,
  SearchIcon,
  XIcon,
} from '@/components/ui/icons';
import { SimpleSelect } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';

/**
 * `key` is the query parameter the endpoint accepts. `column` is the column the
 * box sits under, when the two differ — the visits table shows a derived stage
 * in a column called `status`, and the parameter that filters it is `stage`.
 * Defaults to `key`, which is the usual case.
 */
interface FilterBase {
  key: string;
  column?: string;
  label: string;
}

export type FilterDef =
  | (FilterBase & { type: 'text'; placeholder?: string })
  | (FilterBase & { type: 'select'; options: Array<{ value: string; label: string }> })
  | (FilterBase & { type: 'multi'; options: Array<{ value: string; label: string }> })
  | (FilterBase & { type: 'dateRange' });

/** Where a filter's box belongs in the header row. */
export const filterColumn = (filter: FilterDef): string => filter.column ?? filter.key;

interface Props<TRow> {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  filters: readonly FilterDef[];
  filterValues: Record<string, string>;
  onFilter: (key: string, value: string | undefined) => void;
  activeFilterCount: number;
  onClear: () => void;
  /**
   * The per-column search strip under the headers.
   *
   * Its state is owned by the table, because the row it reveals is part of the
   * table and the button that reveals it is here. Separate from the Filters
   * panel below: one searches a column, the other narrows the whole list, and
   * an operator reaches for them at different moments.
   */
  showColumnSearch: boolean;
  onToggleColumnSearch: () => void;
  /** Id of the search strip, so the button can point at what it controls. */
  searchRegionId: string;
  /** Number of columns that offer a search box; none means no toggle. */
  searchableColumns: number;
  /** Fetches the page again. Every table gets one — see the button below. */
  onRefresh: () => void;
  /** True while a fetch is in flight, so the control can say it is working. */
  refreshing: boolean;
  /** Only header text and visibility handlers are read, so the row type is free. */
  columns: Column<TRow, unknown>[];
  selected: TRow[];
  bulkActions?: (selected: TRow[]) => React.ReactNode;
}

export function TableToolbar<TRow>({
  search,
  onSearch,
  searchPlaceholder,
  filters,
  filterValues,
  onFilter,
  activeFilterCount,
  onClear,
  showColumnSearch,
  onToggleColumnSearch,
  searchRegionId,
  searchableColumns,
  onRefresh,
  refreshing,
  columns,
  selected,
  bulkActions,
}: Props<TRow>) {
  const [showFilters, setShowFilters] = React.useState(activeFilterCount > 0);
  const [showColumns, setShowColumns] = React.useState(false);

  return (
    <div className="border-b border-[var(--ar-border)]">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[14rem] flex-1">
          <InputWithIcon
            icon={SearchIcon}
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>

        {/* Per-column search. A magnifier to open it, a cross to put it away —
            the icon says what the next click does, which is why it changes. */}
        {searchableColumns > 0 ? (
          <Button
            variant={showColumnSearch ? 'primary' : 'outline'}
            size="sm"
            iconOnly
            icon={showColumnSearch ? XIcon : SearchIcon}
            onClick={onToggleColumnSearch}
            aria-expanded={showColumnSearch}
            aria-controls={searchRegionId}
            // Singular on purpose. "Columns" is the accessible name of the
            // button beside it, and two controls answering to the same word
            // makes either of them ambiguous to reach — for a screen reader
            // and for anything driving the page.
            aria-label={showColumnSearch ? 'Hide the column search' : 'Search each column'}
            title={showColumnSearch ? 'Hide the column search' : 'Search each column'}
          />
        ) : null}

        {filters.length > 0 ? (
          <Button
            variant={showFilters ? 'primary' : 'outline'}
            size="sm"
            icon={FilterIcon}
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
            aria-controls={`${searchRegionId}-panel`}
          >
            Filters
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-white/25 px-1.5 text-[0.7rem]">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        ) : null}

        {/* Every table gets one.
            Lists are cached and revalidated in the background, which is what
            makes moving between tabs instant — but it also means a row someone
            else changed a moment ago may be half a minute stale, and there was
            no way to ask for it now. The icon turns while it works, so pressing
            it does something visible even when nothing on screen changes. */}
        <Button
          variant="outline"
          size="sm"
          iconOnly
          icon={RefreshIcon}
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? 'Refreshing' : 'Refresh'}
          title="Refresh"
          className={refreshing ? '[&_svg]:animate-spin' : undefined}
        />

        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            icon={ColumnsIcon}
            iconAfter={ChevronDownIcon}
            onClick={() => setShowColumns((value) => !value)}
            aria-expanded={showColumns}
          >
            Columns
          </Button>
          {showColumns ? (
            <div className="ar-card absolute right-0 z-20 mt-1 w-52 p-2">
              {columns.map((column) => (
                <label
                  key={column.id}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--ar-radius)] px-2 py-1.5 text-[0.85rem] hover:bg-[var(--ar-body-bg)]"
                >
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                  />
                  {typeof column.columnDef.header === 'string'
                    ? column.columnDef.header
                    : column.id}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {activeFilterCount > 0 ? (
          <Button variant="ghost" size="sm" icon={XIcon} onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>

      {showFilters && filters.length > 0 ? (
        <div
          id={`${searchRegionId}-panel`}
          className="grid gap-3 border-t border-[var(--ar-border-soft)] bg-[var(--ar-gray-50)] p-4 md:grid-cols-3 lg:grid-cols-4"
        >
          {filters.map((filter) => (
            <FilterControl
              key={filter.key}
              filter={filter}
              value={filterValues[filter.key] ?? ''}
              onChange={(value) => onFilter(filter.key, value || undefined)}
            />
          ))}
        </div>
      ) : null}

      {bulkActions && selected.length > 0 ? (
        <div className="flex items-center gap-3 border-t border-[var(--ar-border-soft)] bg-[var(--ar-primary-soft)] px-4 py-2.5">
          <span className="text-[0.85rem] font-medium text-[var(--ar-primary)]">
            {selected.length} selected
          </span>
          {bulkActions(selected)}
        </div>
      ) : null}
    </div>
  );
}

function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: FilterDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = (
    <span className="mb-1 block text-[0.75rem] font-medium uppercase tracking-wide text-[var(--ar-text-muted)]">
      {filter.label}
    </span>
  );

  if (filter.type === 'text') {
    return (
      <label className="block">
        {label}
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={filter.placeholder}
        />
      </label>
    );
  }

  if (filter.type === 'select') {
    return (
      <label className="block">
        {label}
        <SimpleSelect
          value={value}
          onValueChange={onChange}
          clearLabel="Any"
          placeholder="Any"
          options={filter.options}
        />
      </label>
    );
  }

  if (filter.type === 'multi') {
    // Comma-joined in the URL so a multi-selection stays shareable and readable.
    return (
      <label className="block">
        {label}
        <MultiSelect
          value={value}
          onValueChange={onChange}
          options={filter.options}
          placeholder="Any"
          searchPlaceholder={`Filter ${filter.label.toLowerCase()}…`}
          aria-label={filter.label}
        />
      </label>
    );
  }

  // dateRange — two dates joined by "..", so one URL parameter carries both.
  const [from = '', to = ''] = value.split('..');
  return (
    <div>
      {label}
      <div className="flex items-center gap-1.5">
        <DateField
          value={from}
          label={`${filter.label} from`}
          onValueChange={(iso) => onChange(`${iso}..${to}`.replace(/^\.\.$/, ''))}
        />
        <span aria-hidden="true" className="text-[var(--ar-text-faint)]">
          –
        </span>
        <DateField
          value={to}
          label={`${filter.label} to`}
          onValueChange={(iso) => onChange(`${from}..${iso}`.replace(/^\.\.$/, ''))}
        />
      </div>
    </div>
  );
}
