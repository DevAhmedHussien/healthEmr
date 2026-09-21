'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_PAGE_SIZE, toSearchParams } from '@health-emr/types';

export interface TableState {
  page: number;
  pageSize: number;
  sort?: string;
  order: 'asc' | 'desc';
  q?: string;
  /** Per-column filters, flattened into the URL as their own parameters. */
  filters: Record<string, string>;
}

/**
 * Table state lives in the URL, not in component state.
 *
 * That is what makes a view shareable and survive a refresh, and it means the
 * back button moves between table states the way a user expects. It also removes
 * a whole class of bug where the URL and the rendered table disagree — there is
 * only ever one source of truth.
 *
 * Navigation uses `replace` with `scroll: false`: changing a filter should not
 * pile up history entries or throw the operator back to the top of the page.
 */
export function useTableState(filterKeys: readonly string[] = []) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const state = React.useMemo<TableState>(() => {
    const filters: Record<string, string> = {};
    for (const key of filterKeys) {
      const value = params.get(key);
      if (value) filters[key] = value;
    }
    return {
      page: Number(params.get('page')) || 1,
      pageSize: Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE,
      sort: params.get('sort') ?? undefined,
      order: (params.get('order') as 'asc' | 'desc') ?? 'desc',
      q: params.get('q') ?? undefined,
      filters,
    };
  }, [params, filterKeys]);

  const push = React.useCallback(
    (next: Partial<TableState>) => {
      const merged = { ...state, ...next, filters: { ...state.filters, ...next.filters } };

      // Any change other than paging returns to page one. Landing on page 7 of a
      // freshly filtered set that now has two pages is disorienting and usually
      // shows nothing.
      const pagingOnly = Object.keys(next).every((key) => key === 'page' || key === 'pageSize');
      if (!pagingOnly) merged.page = 1;

      const search = toSearchParams({
        page: merged.page,
        pageSize: merged.pageSize,
        sort: merged.sort,
        order: merged.order,
        q: merged.q,
        ...merged.filters,
      });

      router.replace(`${pathname}${search.size ? `?${search}` : ''}`, { scroll: false });
    },
    [state, router, pathname],
  );

  const toggleSort = React.useCallback(
    (field: string) => {
      if (state.sort !== field) return push({ sort: field, order: 'asc' });
      if (state.order === 'asc') return push({ sort: field, order: 'desc' });
      // Third click clears the sort rather than cycling forever.
      return push({ sort: undefined, order: 'desc' });
    },
    [state.sort, state.order, push],
  );

  const setFilter = React.useCallback(
    (key: string, value: string | undefined) => push({ filters: { [key]: value ?? '' } }),
    [push],
  );

  const clearAll = React.useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const activeFilterCount = Object.values(state.filters).filter(Boolean).length + (state.q ? 1 : 0);

  return { state, push, toggleSort, setFilter, clearAll, activeFilterCount };
}
