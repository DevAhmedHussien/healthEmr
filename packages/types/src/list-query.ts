import { z } from 'zod';

/**
 * The list-query contract every console table speaks.
 *
 * Offset rather than keyset, deliberately. Keyset is faster at depth and is what
 * the patient-facing feeds use, but it cannot express "page 7 of 43" — and an
 * operator reviewing applications wants page numbers and a shareable URL. These
 * tables are thousands of rows, not millions, so the trade is worth taking here
 * and nowhere else.
 *
 * Each endpoint extends this with its own typed filters, so a filter that does
 * not exist is a validation error rather than a silently ignored parameter.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Resolved against a per-endpoint allowlist — never passed to the database raw. */
  sort: z.string().trim().max(60).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  /** Global search. What it searches is declared per endpoint. */
  q: z.string().trim().max(200).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListMeta {
  /**
   * True when any filter or search narrowed the result.
   *
   * This is what lets the UI tell "No pending applications" apart from "No
   * results for 'xyz'" — the distinction an operator needs and that a bare
   * zero-length array cannot express.
   *
   * Read from the request rather than by counting. A second, unfiltered
   * `COUNT(*)` used to stand here to derive it, which meant every list request
   * counted its whole table twice — 360ms of the 424ms the patients list took
   * at four hundred thousand patients, to answer a question the caller already
   * knew the answer to.
   */
  filtered: boolean;
  /** Which fields this endpoint will sort by, for the UI to render headers. */
  sortable: string[];
}

export interface ListResponse<T> {
  data: T[];
  pageInfo: PageInfo;
  meta: ListMeta;
}

/** Turns table state into a query string, for URL sync and for fetching. */
export function toSearchParams(
  query: Partial<ListQuery> & Record<string, unknown>,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
      continue;
    }
    if (typeof value === 'boolean' && !value) continue;
    params.set(key, String(value));
  }

  // Defaults are omitted so a pristine URL stays clean and shareable.
  if (params.get('page') === '1') params.delete('page');
  if (params.get('pageSize') === String(DEFAULT_PAGE_SIZE)) params.delete('pageSize');

  return params;
}

/**
 * A filter that accepts several values at once, as one comma-joined parameter.
 *
 * One parameter rather than a repeated key keeps the URL short and, more
 * usefully, keeps it readable: `?status=QUEUED,SUBMITTED` says what it does at a
 * glance, which matters because these URLs get pasted to colleagues.
 *
 * Returns undefined when nothing is selected so it can be spread into a `where`
 * unconditionally.
 */
export function csvFilter<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): { in: T[] } | undefined {
  if (!value) return undefined;

  const permitted = new Set<string>(allowed);
  const chosen = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => permitted.has(entry)) as T[];

  return chosen.length ? { in: chosen } : undefined;
}

/** The same, for free-text values with no fixed vocabulary. */
export function csvValues(value: string | undefined, max = 40): { in: string[] } | undefined {
  if (!value) return undefined;
  const chosen = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
  return chosen.length ? { in: chosen } : undefined;
}
