'use client';

import * as React from 'react';
import type { ListResponse } from '@health-emr/types';
import { toSearchParams } from '@health-emr/types';
import type { TableState } from './use-table-state';
import { FRESH_MS, cached, forget, loadList, patchCached } from '@/lib/list-cache';

interface Result<T> {
  rows: T[];
  pageInfo: ListResponse<T>['pageInfo'] | null;
  meta: ListResponse<T>['meta'] | null;
  /** No rows to show yet. Draw a skeleton. */
  loading: boolean;
  /** Rows are on screen and a newer copy is on its way. Draw them, quietly. */
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Take a row off the table now, and reconcile with the server after.
   *
   * For a row that has just been deleted. `refetch` alone is a round-trip the
   * person is made to watch while the thing they deleted sits there, which
   * reads as the delete having failed.
   */
  dropRow: (id: string) => void;
}

/**
 * One page, minus a row, with its counts corrected.
 *
 * Pure, and separate from the hook so it can be tested without a DOM. Returns
 * the page it was given, by identity, when the row is not on it — which is the
 * signal to reconcile with the server and change nothing locally.
 */
export function withoutRow<T>(page: ListResponse<T>, id: string): ListResponse<T> {
  const data = page.data.filter((row) => (row as { id?: string }).id !== id);
  if (data.length === page.data.length) return page;

  const total = Math.max(0, page.pageInfo.total - (page.data.length - data.length));

  return {
    ...page,
    data,
    pageInfo: {
      ...page.pageInfo,
      total,
      // Recomputed rather than left alone, so the pager does not keep offering
      // a page that no longer exists.
      totalPages: Math.max(1, Math.ceil(total / page.pageInfo.pageSize)),
    },
  };
}

/**
 * Fetches a page for a table.
 *
 * Stale-while-revalidate. A cached answer is shown the instant the component
 * mounts and refreshed underneath; only a query nobody has run before draws a
 * skeleton. That is what makes moving between tabs feel like moving between
 * tabs rather than loading four separate pages.
 *
 * The result of an outdated request is discarded rather than the request being
 * aborted. Aborting looked tidier but threw away work already paid for — and in
 * development, where React mounts every component twice, it turned every single
 * navigation into a cancelled request followed by an identical live one.
 */
export function useListQuery<T>(endpoint: string, state: TableState): Result<T> {
  const search = React.useMemo(
    () =>
      toSearchParams({
        page: state.page,
        pageSize: state.pageSize,
        sort: state.sort,
        order: state.order,
        q: state.q,
        ...state.filters,
      }).toString(),
    [state],
  );

  const key = `${endpoint}${search ? `?${search}` : ''}`;
  const seeded = cached<T>(key);

  const [snapshot, setSnapshot] = React.useState<ListResponse<T> | null>(seeded?.body ?? null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    const entry = cached<T>(key);
    const fresh = entry !== undefined && Date.now() - entry.at < FRESH_MS;

    // Show whatever we already have, immediately.
    setSnapshot(entry?.body ?? null);
    setError(null);

    // A forced refetch always goes to the network; a fresh cache entry does not.
    if (fresh && nonce === 0) {
      setRefreshing(false);
      return undefined;
    }

    let live = true;
    setRefreshing(true);

    if (nonce > 0) forget(key);

    loadList<T>(key, `/api/bff/${key}`)
      .then((body) => {
        if (!live) return;
        setSnapshot(body);
        setRefreshing(false);
      })
      .catch((caught: Error) => {
        if (!live) return;
        setError(caught.message);
        setRefreshing(false);
      });

    // Marks the answer unwanted rather than cancelling the request. The work is
    // already done and the next mount will want the same rows.
    return () => {
      live = false;
    };
  }, [key, nonce]);

  const dropRow = React.useCallback(
    (id: string) => {
      const refetch = () => setNonce((value) => value + 1);
      if (!snapshot) return refetch();

      const next = withoutRow(snapshot, id);
      // Not on this page — another table's row, or a page that has since moved.
      // Still worth refetching: something changed even if it was not here.
      if (next === snapshot) return refetch();

      setSnapshot(next);
      patchCached(key, next);
      refetch();
    },
    [snapshot, key],
  );

  return {
    rows: snapshot?.data ?? [],
    pageInfo: snapshot?.pageInfo ?? null,
    meta: snapshot?.meta ?? null,
    loading: snapshot === null && error === null,
    refreshing,
    error,
    refetch: () => setNonce((value) => value + 1),
    dropRow,
  };
}
