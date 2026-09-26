import {
  buildOrderBy,
  listResponse,
  mergeWhere,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from './list-query';
import type { ListQuery } from '@health-emr/types';

const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  pageSize: 25,
  order: 'desc',
  ...over,
});

describe('list-query helpers', () => {
  it('computes skip and take from the page', () => {
    expect(offsetSkipTake(query({ page: 1, pageSize: 25 }))).toEqual({ skip: 0, take: 25 });
    expect(offsetSkipTake(query({ page: 4, pageSize: 10 }))).toEqual({ skip: 30, take: 10 });
  });

  it('refuses a sort field that is not on the allowlist', () => {
    const allowed = ['createdAt', 'lastName'] as const;
    expect(safeSort('lastName', allowed, 'createdAt')).toBe('lastName');
    // The injection and table-scan cases both land here.
    expect(safeSort('passwordHash', allowed, 'createdAt')).toBe('createdAt');
    expect(safeSort('id); drop table users;--', allowed, 'createdAt')).toBe('createdAt');
    expect(safeSort(undefined, allowed, 'createdAt')).toBe('createdAt');
  });

  it('always appends id as a tie-break so paging is stable', () => {
    // Without this, rows sharing a timestamp can appear on two pages or none.
    expect(buildOrderBy('createdAt', 'desc')).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('builds a case-insensitive OR for the global search', () => {
    expect(searchAcross('ker', ['firstName', 'email'])).toEqual({
      OR: [
        { firstName: { contains: 'ker', mode: 'insensitive' } },
        { email: { contains: 'ker', mode: 'insensitive' } },
      ],
    });
  });

  it('reaches through a relation for a dotted field', () => {
    expect(searchAcross('ker', ['user.lastName'])).toEqual({
      OR: [{ user: { lastName: { contains: 'ker', mode: 'insensitive' } } }],
    });
  });

  it('returns undefined for an empty search so it can be spread unconditionally', () => {
    expect(searchAcross(undefined, ['firstName'])).toBeUndefined();
    expect(searchAcross('   ', ['firstName'])).toBeUndefined();
  });

  it('reports filtered from the request, without counting the table again', () => {
    // A search narrowed it, so an empty page means "nothing matched".
    const narrowed = listResponse([], 0, { ...query(), q: 'zyx' }, ['createdAt']);
    expect(narrowed.meta.filtered).toBe(true);

    // Nothing was asked for, so an empty page means "nothing here yet" — and
    // the UI says so instead of "no results".
    const empty = listResponse([], 0, query(), ['createdAt']);
    expect(empty.meta.filtered).toBe(false);
  });

  it('does not mistake paging or sorting for a filter', () => {
    const paged = listResponse([], 0, { page: 3, pageSize: 50, sort: 'createdAt', order: 'asc' }, [
      'createdAt',
    ]);
    // Turning a page is not narrowing anything; treating it as a filter would
    // have every second page of an empty table claim a search found nothing.
    expect(paged.meta.filtered).toBe(false);
  });

  it('ignores a filter parameter that was sent empty', () => {
    // Clearing a box leaves the key behind with nothing in it.
    const cleared = listResponse([], 0, { ...query(), q: '' }, ['createdAt']);
    expect(cleared.meta.filtered).toBe(false);
  });

  it('computes total pages, never fewer than one', () => {
    expect(listResponse([], 0, query(), []).pageInfo.totalPages).toBe(1);
    expect(listResponse([], 51, query({ pageSize: 25 }), []).pageInfo.totalPages).toBe(3);
  });
});

describe('mergeWhere', () => {
  it('merges scalar keys the way a spread would', () => {
    expect(mergeWhere({ tenantId: 't1' }, { voidedAt: null })).toEqual({
      tenantId: 't1',
      voidedAt: null,
    });
  });

  it('skips fragments a conditional left undefined', () => {
    expect(mergeWhere({ tenantId: 't1' }, undefined, null)).toEqual({ tenantId: 't1' });
  });

  it('composes two AND fragments instead of keeping only the last', () => {
    // The bug this exists to prevent: spreading these leaves the second alone.
    const merged = mergeWhere(
      { AND: [{ status: 'APPROVED' }] },
      { AND: [{ patient: { lastName: { contains: 'Marsh' } } }] },
    );

    expect(merged).toEqual({
      AND: [{ status: 'APPROVED' }, { patient: { lastName: { contains: 'Marsh' } } }],
    });
  });

  it('flattens rather than nesting, so SQL depth does not grow per filter', () => {
    const merged = mergeWhere({ AND: [{ a: 1 }, { b: 2 }] }, { AND: [{ c: 3 }] });
    expect(merged.AND).toHaveLength(3);
  });

  it('moves a repeated key under AND rather than overwriting it', () => {
    // Two searches over the same relation both produce `OR`. Both have to hold.
    const merged = mergeWhere({ OR: [{ a: 1 }] }, { OR: [{ b: 2 }] });
    expect(merged).toEqual({ OR: [{ a: 1 }], AND: [{ OR: [{ b: 2 }] }] });
  });

  it('keeps a lone AND fragment addressable', () => {
    expect(mergeWhere({ tenantId: 't1' }, { AND: [{ voidedAt: null }] })).toEqual({
      tenantId: 't1',
      AND: [{ voidedAt: null }],
    });
  });
});
