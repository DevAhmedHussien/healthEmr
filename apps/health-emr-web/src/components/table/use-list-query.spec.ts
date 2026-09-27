import type { ListResponse } from '@health-emr/types';
import { withoutRow } from './use-list-query';

/**
 * Taking a deleted row off the table without waiting for the server.
 *
 * The table fetches its own rows, so nothing about a successful DELETE reaches
 * it on its own — the row sat there until the page was reloaded by hand, which
 * reads as the delete having quietly failed. Removing it locally is the fix,
 * and the counts have to come with it or the pager starts offering a page that
 * is no longer there.
 */

const page = (over: Partial<ListResponse<{ id: string }>> = {}): ListResponse<{ id: string }> => ({
  data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  pageInfo: { page: 1, pageSize: 25, total: 3, totalPages: 1 },
  meta: { filtered: false, sortable: [] },
  ...over,
});

describe('withoutRow', () => {
  it('takes the row out', () => {
    expect(withoutRow(page(), 'b').data).toEqual([{ id: 'a' }, { id: 'c' }]);
  });

  it('brings the total down with it', () => {
    expect(withoutRow(page(), 'b').pageInfo.total).toBe(2);
  });

  it('recomputes the page count, so the pager stops offering a page that has gone', () => {
    const full = page({
      data: Array.from({ length: 25 }, (_, index) => ({ id: `row-${index}` })),
      pageInfo: { page: 1, pageSize: 25, total: 26, totalPages: 2 },
    });

    // The 26th row was the whole of page two.
    expect(withoutRow(full, 'row-0').pageInfo.totalPages).toBe(1);
  });

  it('never reports a negative total, whatever the server last said', () => {
    const stale = page({ pageInfo: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    expect(withoutRow(stale, 'a').pageInfo.total).toBe(0);
  });

  it('keeps at least one page, so an emptied table still renders', () => {
    const last = page({
      data: [{ id: 'a' }],
      pageInfo: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
    const after = withoutRow(last, 'a');

    expect(after.data).toEqual([]);
    expect(after.pageInfo.totalPages).toBe(1);
  });

  /**
   * Identity is the signal, not a copy with the same contents: the caller uses
   * it to decide between "reconcile with the server" and "redraw now", and a
   * fresh object every time would make the second branch unreachable.
   */
  it('returns the very same page when the row is not on it', () => {
    const original = page();
    expect(withoutRow(original, 'not-here')).toBe(original);
  });

  it('leaves everything else on the page alone', () => {
    const original = page();
    const after = withoutRow(original, 'b');

    expect(after.meta).toEqual(original.meta);
    expect(after.pageInfo.page).toBe(1);
    expect(after.pageInfo.pageSize).toBe(25);
    expect(original.data).toHaveLength(3);
  });
});
