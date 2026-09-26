import type { ListMeta, ListQuery, ListResponse, PageInfo } from '@health-emr/types';

/**
 * Server helpers for the list-query contract.
 *
 * The important one is `safeSort`. A sort field arriving from a query string is
 * user input, and putting it into `orderBy` unchecked is both an injection
 * surface and a reliable way to sort on an unindexed column and table-scan
 * production. Every endpoint declares what it will sort by.
 */

export function offsetSkipTake(query: ListQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function safeSort<T extends string>(
  requested: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(requested as T) ? (requested as T) : fallback;
}

/**
 * Builds a Prisma `orderBy`, always appending `id` as a tie-break.
 *
 * Without it, two rows sharing a `createdAt` can swap places between requests,
 * so the same row appears on page 1 and page 2 — or on neither. Paging over an
 * unstable sort is a silent correctness bug, not a cosmetic one.
 */
export function buildOrderBy<T extends string>(
  sort: T,
  order: 'asc' | 'desc',
): Array<Record<string, 'asc' | 'desc'>> {
  return [{ [sort]: order }, { id: order }];
}

export function buildPageInfo(total: number, query: ListQuery): PageInfo {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/**
 * Whether this request narrowed anything.
 *
 * Derived from the parameters rather than by counting the table without them.
 * Every key that is not paging or sorting is a filter, which makes this correct
 * for an endpoint added later without anybody remembering to update it.
 */
const PAGING_KEYS = new Set(['page', 'pageSize', 'sort', 'order', 'limit', 'cursor']);

export function wasFiltered(query: object): boolean {
  return Object.entries(query).some(
    ([key, value]) =>
      !PAGING_KEYS.has(key) &&
      value !== undefined &&
      value !== null &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0),
  );
}

export function listResponse<T>(
  rows: T[],
  total: number,
  query: ListQuery,
  sortable: readonly string[],
): ListResponse<T> {
  const meta: ListMeta = {
    filtered: wasFiltered(query),
    sortable: [...sortable],
  };
  return { data: rows, pageInfo: buildPageInfo(total, query), meta };
}

/**
 * Builds a case-insensitive OR across the given fields for the global search.
 * Returns undefined when there is nothing to search for, so it can be spread
 * into a `where` unconditionally.
 */
export function searchAcross(
  term: string | undefined,
  fields: readonly string[],
): { OR: Array<Record<string, unknown>> } | undefined {
  const value = term?.trim();
  if (!value) return undefined;

  return {
    OR: fields.map((field) => {
      // Dotted paths address a relation, e.g. "user.lastName".
      const path = field.split('.');
      return path.reduceRight<Record<string, unknown>>(
        (acc, segment, index) =>
          index === path.length - 1
            ? { [segment]: { contains: value, mode: 'insensitive' } }
            : { [segment]: acc },
        {},
      );
    }),
  };
}

/**
 * Combines `where` fragments so that none of them can silently erase another.
 *
 * Spreading fragments into one object literal looks equivalent and is not: two
 * fragments carrying the same key — and `AND` is the common one, produced by
 * both `columnFilterWhere` and `visitStageWhere` — leave only the last. The
 * filter the operator typed wins and the stage they picked disappears, so the
 * list quietly answers a wider question than the one on screen.
 *
 * Scalar keys are merged as before; anything that would collide is pushed into
 * a single `AND`, where Prisma composes the clauses rather than choosing
 * between them.
 */
export function mergeWhere<W extends Record<string, unknown>>(
  ...fragments: ReadonlyArray<W | Record<string, unknown> | undefined | null>
): W {
  const merged: Record<string, unknown> = {};
  const and: Array<Record<string, unknown>> = [];

  for (const fragment of fragments) {
    if (!fragment) continue;

    for (const [key, value] of Object.entries(fragment)) {
      if (key === 'AND') {
        // Flattened rather than nested: one AND of many clauses reads the same
        // to Prisma and keeps the generated SQL from growing a level per filter.
        and.push(...(Array.isArray(value) ? value : [value as Record<string, unknown>]));
      } else if (key in merged) {
        and.push({ [key]: value });
      } else {
        merged[key] = value;
      }
    }
  }

  if (and.length) merged.AND = and;

  return merged as W;
}
