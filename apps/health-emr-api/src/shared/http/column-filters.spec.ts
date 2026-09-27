import { columnFilterWhere, type ColumnFilterMap } from './column-filters';

/**
 * Column filters build a `where` clause out of query-string input, so the
 * boundary between "what the endpoint permits" and "what the caller asked for"
 * is the thing worth testing.
 */
describe('columnFilterWhere', () => {
  const MAP = {
    masterId: { path: 'externalMasterId', kind: 'text' },
    patient: { path: 'patient.lastName', kind: 'text' },
    email: { path: 'patient.email', kind: 'text' },
    status: { path: 'status', kind: 'exact' },
    charge: { path: 'quotedPriceCents', kind: 'number' },
    createdAt: { path: 'createdAt', kind: 'date' },
    active: { path: 'isActive', kind: 'boolean' },
  } as const satisfies ColumnFilterMap;

  it('ignores a column the endpoint did not declare', () => {
    // The whole point: a caller cannot filter on a field the view does not show.
    expect(columnFilterWhere({ passwordHash: 'x', notAColumn: 'y' }, MAP)).toEqual({});
  });

  it('ignores blanks, so clearing a box is the same as never typing in it', () => {
    expect(columnFilterWhere({ patient: '   ', status: '' }, MAP)).toEqual({});
  });

  it('matches text loosely and a plain string column exactly but case-insensitively', () => {
    expect(columnFilterWhere({ masterId: 'E2E', status: 'approved' }, MAP)).toEqual({
      AND: [
        { externalMasterId: { contains: 'E2E', mode: 'insensitive' } },
        { status: { equals: 'approved', mode: 'insensitive' } },
      ],
    });
  });

  it('compares a declared enum by symbol, where case-insensitivity is not a thing', () => {
    const map = {
      status: { path: 'status', kind: 'exact', values: ['APPROVED', 'DENIED'] },
    } as const satisfies ColumnFilterMap;

    expect(columnFilterWhere({ status: 'APPROVED' }, map)).toEqual({
      AND: [{ status: { equals: 'APPROVED' } }],
    });
  });

  it('nests a dotted path into the relation', () => {
    expect(columnFilterWhere({ patient: 'marsh' }, MAP)).toEqual({
      AND: [{ patient: { lastName: { contains: 'marsh', mode: 'insensitive' } } }],
    });
  });

  it('keeps two filters on the same relation instead of dropping one', () => {
    // Merged into one object the second would overwrite the first, and the
    // operator would see results for only half of what they typed.
    const where = columnFilterWhere({ patient: 'marsh', email: '@example' }, MAP);
    expect(where).toEqual({
      AND: [
        { patient: { lastName: { contains: 'marsh', mode: 'insensitive' } } },
        { patient: { email: { contains: '@example', mode: 'insensitive' } } },
      ],
    });
  });

  it('reads a number as a value or a range', () => {
    expect(columnFilterWhere({ charge: '2500' }, MAP)).toEqual({
      AND: [{ quotedPriceCents: { equals: 2500 } }],
    });
    expect(columnFilterWhere({ charge: '1000..5000' }, MAP)).toEqual({
      AND: [{ quotedPriceCents: { gte: 1000, lte: 5000 } }],
    });
    expect(columnFilterWhere({ charge: '1000..' }, MAP)).toEqual({
      AND: [{ quotedPriceCents: { gte: 1000 } }],
    });
  });

  it('drops a number that is not one', () => {
    expect(columnFilterWhere({ charge: 'lots' }, MAP)).toEqual({});
  });

  it('reads a single day as the whole day, not the instant midnight', () => {
    expect(columnFilterWhere({ createdAt: '2026-09-20' }, MAP)).toEqual({
      AND: [
        {
          createdAt: {
            gte: new Date('2026-09-20T00:00:00.000Z'),
            lt: new Date('2026-09-21T00:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('reads a date range with the end day included', () => {
    expect(columnFilterWhere({ createdAt: '2026-09-01..2026-09-20' }, MAP)).toEqual({
      AND: [
        {
          createdAt: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lt: new Date('2026-09-21T00:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('drops a date that is not one rather than filtering on nonsense', () => {
    expect(columnFilterWhere({ createdAt: 'last tuesday' }, MAP)).toEqual({});
  });

  it('matches nothing when an enum column is given a value it cannot hold', () => {
    // Postgres refuses a comparison against a value outside the enum, so a typo
    // in a filter box would otherwise be a 500 rather than an empty table.
    const withEnum = {
      platform: { path: 'platform', kind: 'exact', values: ['LIFEFILE', 'GENERIC_HTTP'] },
    } as const satisfies ColumnFilterMap;

    expect(columnFilterWhere({ platform: 'zqx' }, withEnum)).toEqual({
      AND: [{ platform: { in: [] } }],
    });
    expect(columnFilterWhere({ platform: 'LIFEFILE' }, withEnum)).toEqual({
      AND: [{ platform: { equals: 'LIFEFILE' } }],
    });
  });

  it('reaches through a to-many relation', () => {
    const map = {
      states: { path: 'licenses[].state', kind: 'text' },
    } as const satisfies ColumnFilterMap;

    expect(columnFilterWhere({ states: 'TX' }, map)).toEqual({
      AND: [{ licenses: { some: { state: { contains: 'TX', mode: 'insensitive' } } } }],
    });
  });

  it('reaches through two of them', () => {
    // "Does this visit have any prescription with any order carrying that
    // tracking number" — which is what a shipment column is showing.
    const map = {
      tracking: { path: 'prescriptions[].orders[].trackingNumber', kind: 'text' },
    } as const satisfies ColumnFilterMap;

    expect(columnFilterWhere({ tracking: '1Z9' }, map)).toEqual({
      AND: [
        {
          prescriptions: {
            some: { orders: { some: { trackingNumber: { contains: '1Z9', mode: 'insensitive' } } } },
          },
        },
      ],
    });
  });

  it('matches a scalar array with has', () => {
    const map = {
      statesServed: { path: 'statesServed', kind: 'list' },
    } as const satisfies ColumnFilterMap;

    expect(columnFilterWhere({ statesServed: 'TX' }, map)).toEqual({
      AND: [{ statesServed: { has: 'TX' } }],
    });
  });

  it('answers none and any on a count column, and nothing else', () => {
    const map = { visits: { path: 'requests', kind: 'presence' } } as const satisfies ColumnFilterMap;

    expect(columnFilterWhere({ visits: 'none' }, map)).toEqual({ AND: [{ requests: { none: {} } }] });
    expect(columnFilterWhere({ visits: 'any' }, map)).toEqual({ AND: [{ requests: { some: {} } }] });
    // A threshold is not something the database can answer here, so it is
    // ignored rather than silently treated as "any".
    expect(columnFilterWhere({ visits: '5' }, map)).toEqual({});
  });

  /**
   * A cell reading "Elena Marsh" is two fields joined for display. Matching
   * only the surname meant typing what was on screen found nothing, which is
   * the first thing anybody tries.
   */
  describe('a name spread across two columns', () => {
    const map = {
      patient: {
        path: 'patient.lastName',
        kind: 'name',
        paths: ['patient.firstName', 'patient.lastName'],
      },
    } as const satisfies ColumnFilterMap;

    const matches = (term: string) =>
      JSON.stringify(columnFilterWhere({ patient: term }, map));

    it('finds a first name', () => {
      expect(matches('Elena')).toContain('"firstName":{"contains":"Elena"');
      expect(matches('Elena')).toContain('"lastName":{"contains":"Elena"');
    });

    it('finds a surname', () => {
      expect(matches('Marsh')).toContain('"lastName":{"contains":"Marsh"');
    });

    it('finds the whole name as it is displayed', () => {
      const where = columnFilterWhere({ patient: 'Elena Marsh' }, map) as {
        AND: Array<{ AND: Array<{ OR: unknown[] }> }>;
      };
      // Both words have to match something, and either field will do for each —
      // so "Elena Marsh" and "Marsh Elena" both find her.
      expect(where.AND[0].AND).toHaveLength(2);
      expect(where.AND[0].AND[0].OR).toHaveLength(2);
    });

    it('treats the words the same way round either way', () => {
      expect(matches('Elena Marsh').length).toBe(matches('Marsh Elena').length);
    });

    it('ignores punctuation that came along with a pasted cell', () => {
      // Copying "Marsh, Elena" out of the column and dropping it in the box.
      expect(matches('Marsh, Elena')).toBe(matches('Marsh Elena'));
      expect(matches('(AZ)')).toBe(matches('AZ'));
    });

    it('keeps punctuation inside a word, which is part of the word', () => {
      expect(matches('AZ-12345')).toContain('AZ-12345');
      expect(matches("O'Brien")).toContain("O'Brien");
    });

    it('is not fooled by a term that is only punctuation', () => {
      expect(columnFilterWhere({ patient: '---' }, map)).toEqual({});
    });

    it('ignores the spacing somebody actually types', () => {
      expect(matches('  Elena   Marsh ')).toBe(matches('Elena Marsh'));
    });
  });

  it('reads a boolean', () => {
    expect(columnFilterWhere({ active: 'true' }, MAP)).toEqual({ AND: [{ isActive: { equals: true } }] });
    expect(columnFilterWhere({ active: 'false' }, MAP)).toEqual({ AND: [{ isActive: { equals: false } }] });
  });
});
