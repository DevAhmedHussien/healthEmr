/**
 * Counting a relation for one page of rows.
 *
 * Prisma's `_count` inside a `select` looks like the obvious way to put "how
 * many visits has this patient had" in a list. It is not: it joins and groups
 * over the *whole* relation rather than the rows on the page, so a list of
 * twenty-five patients counted across a million visits took 408ms — of which
 * 379ms was the counting. The same page without it took 29ms.
 *
 * `groupBy`, scoped to the ids actually on screen, is 33ms and stays flat as
 * the tables grow, because every one of those lookups is an index seek.
 *
 *   const rows = await prisma.patient.findMany({ …no _count… });
 *   const visits = await countsByKey(
 *     prisma.prescriptionRequest, 'patientId', rows.map((row) => row.id),
 *   );
 *   visits.get(row.id) ?? 0
 */
/**
 * Turns Prisma's grouped rows into a lookup.
 *
 * The callback is typed by Prisma at the call site — which is where mistakes
 * actually happen, because that is where a field name is written. Its *return*
 * is read structurally here rather than declared, because Prisma's `groupBy`
 * return type is inferred from its argument and binding it to a declared type
 * makes the argument unassignable. The shape is checked at runtime instead.
 */
export async function countsByKey(
  key: string,
  ids: readonly string[],
  group: (ids: string[]) => Promise<unknown>,
): Promise<Map<string, number>> {
  // An empty `in` is a query that can only return nothing.
  if (ids.length === 0) return new Map();

  const rows = await group([...ids]);
  const counts = new Map<string, number>();
  if (!Array.isArray(rows)) return counts;

  for (const row of rows as Array<Record<string, unknown>>) {
    const id = row[key];
    const all = (row._count as { _all?: unknown } | undefined)?._all;
    if (typeof id === 'string' && typeof all === 'number') counts.set(id, all);
  }
  return counts;
}
