import { z } from 'zod';

/**
 * Two pagination styles, because the right one depends on the screen.
 *
 * KEYSET (cursor) is the default for anything that grows without bound — audit
 * logs, orders, messages. It stays O(limit) at any depth, and it does not skip
 * or repeat rows when the underlying data changes between pages.
 *
 * OFFSET is kept for admin tables where a human wants "page 7 of 43" and the
 * dataset is small enough that `OFFSET n` is not a sequential scan. Using it on
 * a large table is how a list endpoint quietly becomes the slowest query in the
 * system, so it is opt-in per endpoint rather than the default.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export const keysetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Opaque. Clients pass back what the previous page returned; never construct one. */
  cursor: z.string().trim().max(500).optional(),
  order: sortOrderSchema,
});

export const offsetQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  order: sortOrderSchema,
});

export type KeysetQuery = z.infer<typeof keysetQuerySchema>;
export type OffsetQuery = z.infer<typeof offsetQuerySchema>;

export interface KeysetPage<T> {
  data: T[];
  pageInfo: { nextCursor: string | null; hasMore: boolean; limit: number };
}


interface CursorPayload {
  /** Tie-breaker. Always the row id, so the ordering is total and stable. */
  id: string;
  /** The value of the sort column on that row. */
  value: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.id !== 'string' || typeof parsed?.value !== 'string') return null;
    return parsed as CursorPayload;
  } catch {
    // A malformed cursor is a client bug, not a server error — start from the
    // first page rather than throwing a 500 at someone with a stale bookmark.
    return null;
  }
}

/**
 * Builds the Prisma `where` fragment for a keyset page.
 *
 * The comparison is on (sortField, id) as a pair, not sortField alone — rows
 * sharing a timestamp would otherwise be skipped or repeated at the page
 * boundary, which is the classic keyset bug.
 */
export function keysetWhere(
  cursor: string | undefined,
  sortField: string,
  order: 'asc' | 'desc',
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;

  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;

  const operator = order === 'desc' ? 'lt' : 'gt';
  const boundary = Number.isNaN(Date.parse(decoded.value)) ? decoded.value : new Date(decoded.value);

  return {
    OR: [
      { [sortField]: { [operator]: boundary } },
      { [sortField]: boundary, id: { [operator]: decoded.id } },
    ],
  };
}

/**
 * Turns `limit + 1` rows into a page. Fetching one extra row is how `hasMore` is
 * known without a second COUNT query.
 */
export function toKeysetPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortField: keyof T,
): KeysetPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];

  const raw = last?.[sortField];
  const value = raw instanceof Date ? raw.toISOString() : String(raw ?? '');

  return {
    data,
    pageInfo: {
      hasMore,
      limit,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id, value }) : null,
    },
  };
}


export function offsetSkipTake(query: OffsetQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/**
 * Resolves a client-supplied sort field against an allowlist.
 *
 * User input never reaches `orderBy` directly: an unbounded sort column is both
 * an injection surface and a reliable way to sort on an unindexed column and
 * table-scan production.
 */
export function safeSort<T extends string>(
  requested: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(requested as T) ? (requested as T) : fallback;
}
