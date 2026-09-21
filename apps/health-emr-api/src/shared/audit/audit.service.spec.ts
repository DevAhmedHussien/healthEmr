import { chainHash, type ChainedFields } from './audit.service';

const base: ChainedFields = {
  sequence: '1',
  prevHash: null,
  tenantSlug: 'ten-1',
  actorEmail: null,
  actorRole: null,
  action: 'PHI_CREATED',
  entityType: 'PrescriptionRequest',
  entityId: 'req-1',
  patientId: 'pat-1',
  before: null,
  after: { masterId: 'M-1', visitType: 'weightloss', status: 'ASSIGNED' },
};

describe('audit chain hash', () => {
  it('is stable across runs', () => {
    expect(chainHash(base)).toBe(chainHash({ ...base }));
  });

  it('does not depend on key order inside before/after', () => {
    // Postgres jsonb reorders keys on the way back out. If the hash depended on
    // key order, every row would fail verification the moment it was re-read.
    const reordered: ChainedFields = {
      ...base,
      after: { status: 'ASSIGNED', masterId: 'M-1', visitType: 'weightloss' },
    };
    expect(chainHash(reordered)).toBe(chainHash(base));
  });

  it('does not depend on key order in nested objects', () => {
    const a: ChainedFields = { ...base, after: { outer: { x: 1, y: 2 }, z: 3 } };
    const b: ChainedFields = { ...base, after: { z: 3, outer: { y: 2, x: 1 } } };
    expect(chainHash(a)).toBe(chainHash(b));
  });

  it('preserves array order, which is meaningful', () => {
    const a: ChainedFields = { ...base, after: { items: ['x', 'y'] } };
    const b: ChainedFields = { ...base, after: { items: ['y', 'x'] } };
    expect(chainHash(a)).not.toBe(chainHash(b));
  });

  it('changes when any covered value changes', () => {
    expect(chainHash({ ...base, entityId: 'req-2' })).not.toBe(chainHash(base));
    expect(chainHash({ ...base, patientId: 'pat-2' })).not.toBe(chainHash(base));
    expect(chainHash({ ...base, after: { ...(base.after as object), status: 'DENIED' } }))
      .not.toBe(chainHash(base));
  });

  it('changes when the link to the previous row changes', () => {
    expect(chainHash({ ...base, prevHash: 'deadbeef' })).not.toBe(chainHash(base));
  });

  it('distinguishes a missing value from an empty one', () => {
    expect(chainHash({ ...base, before: null })).not.toBe(chainHash({ ...base, before: {} }));
  });
});

describe('canonicalisation of values Postgres rewrites', () => {
  /**
   * These are the shapes that previously hashed one way and persisted another.
   * The chain is only worth having if what we hash is what comes back.
   */
  const withDate = {
    sequence: '1',
    prevHash: null,
    tenantSlug: null,
    actorEmail: null,
    actorRole: null,
    action: 'PRESCRIPTION_SIGNED' as const,
    entityType: 'Prescription',
    entityId: 'rx-1',
    patientId: null,
    before: null,
    after: { signedAt: new Date('2026-09-18T14:11:55.537Z'), licenseState: 'AZ' },
  };

  it('hashes a Date exactly as the stored ISO string does', () => {
    const asWritten = chainHash(withDate);
    const asReadBack = chainHash({
      ...withDate,
      after: { signedAt: '2026-09-18T14:11:55.537Z', licenseState: 'AZ' },
    });
    expect(asWritten).toBe(asReadBack);
  });

  it('does not collapse a Date to an empty object', () => {
    const empty = chainHash({ ...withDate, after: { signedAt: {}, licenseState: 'AZ' } });
    expect(chainHash(withDate)).not.toBe(empty);
  });

  it('handles a bigint without throwing', () => {
    expect(() => chainHash({ ...withDate, after: { count: 10n } })).not.toThrow();
  });

  it('still detects a changed value', () => {
    const tampered = chainHash({
      ...withDate,
      after: { signedAt: new Date('2026-09-18T14:11:55.538Z'), licenseState: 'AZ' },
    });
    expect(chainHash(withDate)).not.toBe(tampered);
  });
});

describe('attribution survives the account it refers to', () => {
  /**
   * `actorUserId` and `tenantId` are SET NULL on delete. When the hash covered
   * them, removing a user rewrote the content of every entry they appeared in
   * and the verifier — correctly — reported tampering for something nobody
   * tampered with. The chain covers the frozen email and slug instead.
   */
  const entry: ChainedFields = {
    sequence: '7',
    prevHash: 'abc',
    tenantSlug: 'joeyMed',
    actorEmail: 'dr.okafor@healthemr.test',
    actorRole: 'PROVIDER',
    action: 'PRESCRIPTION_SIGNED',
    entityType: 'Prescription',
    entityId: 'rx-7',
    patientId: null,
    before: null,
    after: { licenseState: 'TX' },
  };

  // That the nullable foreign keys cannot reach the hash is now guaranteed by
  // ChainedFields itself — they are not fields of it. What is worth asserting is
  // that the text which replaced them still behaves like part of the chain.

  it('still changes when the actor does', () => {
    expect(chainHash(entry)).not.toBe(chainHash({ ...entry, actorEmail: 'someone.else@healthemr.test' }));
  });

  it('still changes when the account does', () => {
    expect(chainHash(entry)).not.toBe(chainHash({ ...entry, tenantSlug: 'acmeHealth' }));
  });
});
