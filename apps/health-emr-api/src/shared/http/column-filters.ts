import { z } from 'zod';

/**
 * Per-column filtering for list endpoints.
 *
 * The same argument as `safeSort`: a column name arriving in a query string is
 * user input. Every endpoint declares which of its columns may be filtered and
 * where each one lives in the model, so a caller can never reach a field the
 * view does not show — or filter on an unindexed column and table-scan
 * production.
 *
 * Filtering happens in the database, not the browser. A table here is one page
 * of a much larger set, so filtering the rows already on screen would quietly
 * search a twenty-fifth of the data and report nothing found.
 */
export type ColumnFilterKind =
  | 'text'
  | 'exact'
  | 'date'
  | 'number'
  | 'boolean'
  /**
   * A column backed by a scalar array — `statesServed String[]`. Matches when
   * the array contains the value.
   */
  | 'list'
  /**
   * A person's name, spread across more than one column.
   *
   * A cell reading "Elena Marsh" is two fields joined for display, and matching
   * only one of them means typing what is on screen finds nothing — which is
   * exactly what somebody does first. Declare every field the name is built
   * from in `paths`.
   */
  | 'name'
  /**
   * A column showing how many related rows there are.
   *
   * Only "none" and "any" are offered, because those are the questions the
   * database can answer: Prisma has no `where` on a relation count, so a
   * threshold like "more than five visits" would need the whole query
   * rewritten in SQL. A box accepting `5` and quietly returning everything
   * with at least one would be worse than the two honest options.
   */
  | 'presence';

export interface ColumnFilter {
  /**
   * The fields a `name` filter searches, in display order.
   *
   * Ignored by every other kind, which addresses one field through `path`.
   */
  paths?: readonly string[];
  /**
   * Dotted path into the model, e.g. `patient.lastName`.
   *
   * A segment ending in `[]` is a to-many relation and becomes a `some`:
   * `prescriptions[].orders[].trackingNumber` asks whether the row has any
   * prescription with any order carrying that tracking number — which is
   * exactly what a column rendering "the shipment" is showing.
   */
  path: string;
  kind: ColumnFilterKind;
  /**
   * The permitted values, for a column backed by a database enum.
   *
   * Postgres rejects a comparison against a value outside the enum, so passing
   * a typo straight through turns a filter box into a 500. Declared here, an
   * unrecognised value matches nothing instead — which is the honest answer to
   * "show me the rows where status is zqx".
   */
  values?: readonly string[];
}

export type ColumnFilterMap = Readonly<Record<string, ColumnFilter>>;

/**
 * One optional query parameter per filterable column, for the endpoint's DTO.
 *
 * Generic over the map so the returned shape names its keys. Typed as the wide
 * `ZodRawShape` it would carry an index signature, and `schema.extend()` would
 * widen the whole schema to match — quietly erasing the types of every field
 * the endpoint already had.
 */
export function columnFilterShape<M extends ColumnFilterMap>(
  map: M,
): { [K in keyof M]: z.ZodOptional<z.ZodString> } {
  return Object.fromEntries(
    Object.keys(map).map((key) => [key, z.string().trim().max(200).optional()]),
  ) as { [K in keyof M]: z.ZodOptional<z.ZodString> };
}

/**
 * Builds the `where` fragment for whichever column filters were supplied.
 *
 * Everything lands under `AND` rather than being merged into the top level.
 * Two filters on the same relation — a patient's surname and their email —
 * both produce `{ patient: … }`, and spreading those into one object silently
 * drops the first. Under `AND` they compose, which is what the operator typing
 * in two boxes is asking for.
 */
export function columnFilterWhere(
  /** The parsed query object. Typed loosely so a Nest DTO class can be passed. */
  values: object,
  map: ColumnFilterMap,
): { AND: Array<Record<string, unknown>> } | Record<string, never> {
  const supplied = values as Record<string, unknown>;
  const clauses: Array<Record<string, unknown>> = [];

  for (const [key, filter] of Object.entries(map)) {
    const raw = supplied[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;

    if (filter.kind === 'name') {
      const clause = nameClause(filter.paths ?? [filter.path], value);
      if (clause) clauses.push(clause);
      continue;
    }

    if (filter.kind === 'presence') {
      if (value !== 'none' && value !== 'any') continue;
      clauses.push(nest(filter.path, value === 'none' ? { none: {} } : { some: {} }));
      continue;
    }

    const condition =
      filter.values && !filter.values.includes(value)
        ? MATCHES_NOTHING
        : conditionFor(filter.kind, value, Boolean(filter.values));
    if (condition !== undefined) clauses.push(nest(filter.path, condition));
  }

  return clauses.length ? { AND: clauses } : {};
}

/**
 * An empty `in` is false for every row — the way to say "no match" without
 * handing the database a value its column type will refuse.
 */
const MATCHES_NOTHING = { in: [] as string[] };

/**
 * Matches a name typed the way it is displayed.
 *
 * Every word has to match one of the name fields, and any of them will do. That
 * covers the three things people actually type: a first name, a surname, and
 * the whole thing as it appears in the cell — in either order, because a list
 * sorted by surname invites "Marsh Elena" as readily as "Elena Marsh".
 *
 * A middle word that matches nothing narrows the result to nothing, which is
 * the honest answer rather than a loose match on one half of what was asked.
 */
function nameClause(
  paths: readonly string[],
  value: string,
): Record<string, unknown> | undefined {
  const words = value
    .split(/\s+/)
    // People paste the cell rather than retype it, so the words arrive wearing
    // whatever punctuation joined them on screen: `Austin,` from an address,
    // `(AZ)` from a licence. Held literally, none of those match the column
    // they came from. Inner punctuation stays — `AZ-12345` is one word, and
    // `O'Brien` is a name.
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .slice(0, 5);
  if (!words.length || !paths.length) return undefined;

  return {
    AND: words.map((word) => ({
      OR: paths.map((path) => nest(path, { contains: word, mode: 'insensitive' })),
    })),
  };
}

/**
 * Turns `patient.user.lastName` into `{ patient: { user: { lastName: … } } }`,
 * and `orders[].trackingNumber` into `{ orders: { some: { trackingNumber: … } } }`.
 */
function nest(path: string, condition: unknown): Record<string, unknown> {
  const segments = path.split('.');

  return segments.reduceRight<Record<string, unknown>>((acc, segment, index) => {
    const inner = index === segments.length - 1 ? condition : acc;
    return segment.endsWith('[]')
      ? { [segment.slice(0, -2)]: { some: inner } }
      : { [segment]: inner };
  }, {});
}

function conditionFor(kind: ColumnFilterKind, value: string, enumBacked: boolean): unknown {
  switch (kind) {
    case 'text':
      return { contains: value, mode: 'insensitive' };

    // Enums, ids and two-letter states. A substring match on a status would let
    // "SHIP" match both SHIPPED and a future NOT_SHIPPED, so these are equality
    // — but equality that ignores case, because nobody types `TX` when the box
    // is next to a column showing `TX` and their keyboard is in lower case.
    // Declared enums are exempt: Postgres compares those by symbol, not text.
    case 'exact':
      return enumBacked ? { equals: value } : { equals: value, mode: 'insensitive' };

    case 'boolean':
      return { equals: value === 'true' };

    case 'number':
      return numberCondition(value);

    case 'date':
      return dateCondition(value);

    case 'list':
      return { has: value };

    // Handled before this point: it spans several fields rather than one.
    case 'name':
      return undefined;

    // Handled before this point: it produces a whole clause rather than a
    // condition to nest under a field.
    case 'presence':
      return undefined;
  }
}

/** `12`, `10..`, `..50` or `10..50` — the range forms a column header offers. */
function numberCondition(value: string): unknown {
  if (!value.includes('..')) {
    const exact = Number(value);
    return Number.isFinite(exact) ? { equals: exact } : undefined;
  }

  const [from, to] = value.split('..');
  const range: Record<string, number> = {};
  if (from && Number.isFinite(Number(from))) range.gte = Number(from);
  if (to && Number.isFinite(Number(to))) range.lte = Number(to);
  return Object.keys(range).length ? range : undefined;
}

/**
 * A day (`2026-09-20`) or a range (`2026-09-01..2026-09-20`).
 *
 * A single day is a half-open interval, not an equality: the column holds a
 * timestamp, and `equals` on a date would match only the instant midnight.
 * The upper bound is exclusive of the following day for the same reason.
 */
function dateCondition(value: string): unknown {
  const [from, to] = value.includes('..') ? value.split('..') : [value, value];
  const range: Record<string, Date> = {};

  const start = parseDay(from);
  if (start) range.gte = start;

  const end = parseDay(to);
  if (end) range.lt = new Date(end.getTime() + 86_400_000);

  return Object.keys(range).length ? range : undefined;
}

function parseDay(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  const parsed = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
