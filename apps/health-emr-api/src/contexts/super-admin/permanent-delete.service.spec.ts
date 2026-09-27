import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformPermission, Role } from '@health-emr/types';
import type { AuthenticatedUser } from '@health-emr/types';
import {
  PermanentDeleteService,
  TENANT_DELETE_BLOCKERS,
  TENANT_DELETE_CASCADE_OK,
} from './permanent-delete.service';

/**
 * What stops a client account being erased, and what may be cleared out of the
 * way.
 *
 * Deleting a tenant cascades into fifteen tables, so the first half of this
 * file reads the Prisma DMMF and fails when a model carrying a tenant key is
 * classified in neither list — that is the check that catches the next table
 * somebody adds. The rest is the division that matters: records of care and of
 * money stop the deletion for everybody, and a staff login can go with the
 * account it belongs to if whoever is asking may take it and it wrote nothing
 * clinical.
 */

/** Prisma's model name (`PrescriptionRequest`) as the client spells it. */
const asClientKey = (model: string) => model[0].toLowerCase() + model.slice(1);

const OWNER: AuthenticatedUser = {
  id: 'owner-1',
  email: 'owner@healthemr.test',
  role: Role.OWNER,
  tenantId: null,
  permissions: [],
} as unknown as AuthenticatedUser;

const granted: AuthenticatedUser = {
  id: 'super-1',
  email: 'ops@healthemr.test',
  role: Role.SUPER_ADMIN,
  tenantId: null,
  permissions: [PlatformPermission.ACCOUNTS_DELETE],
} as unknown as AuthenticatedUser;

const ungranted: AuthenticatedUser = {
  id: 'super-2',
  email: 'reader@healthemr.test',
  role: Role.SUPER_ADMIN,
  tenantId: null,
  permissions: [],
} as unknown as AuthenticatedUser;

interface Staff {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  archivedAt: Date | null;
}

const staffMember = (over: Partial<Staff> = {}): Staff => ({
  id: 'staff-1',
  email: 'admin@client.test',
  role: Role.ADMIN,
  isActive: false,
  archivedAt: null,
  ...over,
});

/**
 * A Prisma stand-in.
 *
 * Every count answers zero unless the test says otherwise, so a case can say
 * "only this table has rows" and read back what the service concluded. The
 * transaction client is the same object, which is what makes the recount
 * inside the transaction testable at all: `onTransaction` lets a test change
 * the world between the first count and the second, the way a tenant's own
 * server would by posting a visit mid-delete.
 */
function harness(options: {
  counts?: Record<string, number>;
  staff?: Staff[];
  /** Clinical rows keyed by user id, for the staff reference guard. */
  references?: Record<string, Partial<Record<'note' | 'message' | 'participant' | 'profile' | 'patient', number>>>;
  onTransaction?: (db: Record<string, never>) => void;
  failDelete?: Error;
} = {}) {
  const counts = options.counts ?? {};
  const staff = options.staff ?? [];
  const references = options.references ?? {};
  const deleted: string[] = [];

  const refCount = (kind: 'note' | 'message' | 'participant' | 'profile' | 'patient') =>
    jest.fn(async ({ where }: { where: { authorUserId?: string; userId?: string } }) => {
      const id = where.authorUserId ?? where.userId ?? '';
      return references[id]?.[kind] ?? 0;
    });

  const db: Record<string, unknown> = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: 't1', slug: 'joey-okj' }),
      delete: jest.fn(async () => {
        if (options.failDelete) throw options.failDelete;
        deleted.push('tenant');
        return { id: 't1' };
      }),
    },
    user: {
      count: jest.fn(async () => counts.User ?? staff.length),
      findMany: jest.fn(async () => staff),
      deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        deleted.push(...where.id.in);
        return { count: where.id.in.length };
      }),
    },
    providerNote: { count: refCount('note') },
    chatMessage: { count: refCount('message') },
    chatParticipant: { count: refCount('participant') },
    providerProfile: { count: refCount('profile') },
    patient: { count: refCount('patient') },
  };

  for (const model of TENANT_DELETE_BLOCKERS) {
    const key = asClientKey(model);
    if (key === 'user') continue;
    db[key] = { count: jest.fn(async () => counts[model] ?? 0) };
  }

  const raw = {
    ...db,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      options.onTransaction?.(db as Record<string, never>);
      return fn(db);
    }),
  };

  const audit = { record: jest.fn() };
  return {
    service: new PermanentDeleteService({ raw } as never, audit as never),
    audit,
    deleted,
    db,
  };
}

describe('tenant delete blockers', () => {
  const modelsWithTenantKey = Prisma.dmmf.datamodel.models
    .filter((model) =>
      model.fields.some((field) => field.name === 'tenantId' || field.name === 'primaryTenantId'),
    )
    .map((model) => model.name)
    .sort();

  it('classifies every model that carries a tenant key', () => {
    const unaccounted = modelsWithTenantKey.filter(
      (name) =>
        !TENANT_DELETE_BLOCKERS.includes(name as never) && !(name in TENANT_DELETE_CASCADE_OK),
    );
    expect(unaccounted).toEqual([]);
  });

  it('blocks on nothing that has no tenant key', () => {
    const spurious = TENANT_DELETE_BLOCKERS.filter((name) => !modelsWithTenantKey.includes(name));
    expect(spurious).toEqual([]);
  });

  it('gives every cascade a written reason', () => {
    for (const [model, reason] of Object.entries(TENANT_DELETE_CASCADE_OK)) {
      expect(`${model}: ${reason}`.length).toBeGreaterThan(60);
    }
  });

  /**
   * The five that were missing. Named individually rather than left to the
   * count above, because this is the regression: each is clinical or financial,
   * each cascades, and each was silently destroyed.
   */
  it('blocks on the clinical and financial tables that cascade', () => {
    for (const model of ['Encounter', 'QaSubmission', 'ChatThread', 'PharmacyOrder', 'ProviderEarning']) {
      expect(TENANT_DELETE_BLOCKERS).toContain(model);
    }
  });

  it('never allows an audit log to be classified as disposable', () => {
    expect(TENANT_DELETE_BLOCKERS).not.toContain('AuditLog');
    expect(TENANT_DELETE_CASCADE_OK.AuditLog).toMatch(/SET NULL|never deleted/i);
  });
});

describe('inspect', () => {
  it('reports a clean tenant as deletable by anybody', async () => {
    const { service } = harness();
    const report = await service.inspect('tenant', 't1', OWNER);

    expect(report.deletable).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.alternative).toBeNull();
  });

  it.each(TENANT_DELETE_BLOCKERS.filter((model) => model !== 'User'))(
    'counts %s when deciding',
    async (model) => {
      const { service } = harness({ counts: { [model]: 3 } });
      const report = await service.inspect('tenant', 't1', OWNER);

      expect(report.deletable).toBe(false);
      expect(report.hardBlockers.map((blocker) => blocker.count)).toContain(3);
    },
  );

  it('separates staff from the clinical blockers', async () => {
    const { service } = harness({ counts: { Encounter: 2 }, staff: [staffMember()] });
    const report = await service.inspect('tenant', 't1', OWNER);

    expect(report.hardBlockers).toEqual([{ count: 2, what: 'clinical encounters' }]);
    expect(report.staffBlockers).toEqual([{ count: 1, what: 'staff account' }]);
    // Clinical data is in the way, so no grant makes this deletable.
    expect(report.deletableByOwner).toBe(false);
  });

  it('offers the owner a way through when only staff are in the way', async () => {
    const { service } = harness({ staff: [staffMember()] });
    const report = await service.inspect('tenant', 't1', OWNER);

    expect(report.deletable).toBe(false);
    expect(report.deletableByOwner).toBe(true);
    expect(report.staffAccounts).toHaveLength(1);
    expect(report.confirmPhrase).toBe('joey-okj');
  });

  it('offers nothing to a super admin without the grant', async () => {
    const { service } = harness({ staff: [staffMember()] });
    const report = await service.inspect('tenant', 't1', ungranted);

    expect(report.deletableByOwner).toBe(false);
  });

  it('refuses a tenant that does not exist', async () => {
    const { service, db } = harness();
    (db.tenant as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);

    await expect(service.inspect('tenant', 't1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('remove', () => {
  it('deletes the tenant and its staff when only staff were in the way', async () => {
    const { service, deleted } = harness({ staff: [staffMember({ id: 'staff-9' })] });

    const result = await service.remove('tenant', 't1', 'created during setup', OWNER, true);

    expect(result.removed).toBe(true);
    expect(result.staffAccountsRemoved).toEqual(['admin@client.test']);
    expect(deleted).toEqual(['staff-9', 'tenant']);
  });

  it('refuses without the caller agreeing to take the staff', async () => {
    const { service, deleted } = harness({ staff: [staffMember()] });

    await expect(service.remove('tenant', 't1', 'created during setup', OWNER)).rejects.toThrow(
      /1 staff account refers to it/,
    );
    expect(deleted).toEqual([]);
  });

  it('refuses a super admin who was never granted account deletion', async () => {
    const { service, deleted } = harness({ staff: [staffMember()] });

    await expect(
      service.remove('tenant', 't1', 'created during setup', ungranted, true),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleted).toEqual([]);
  });

  it('lets a granted super admin through', async () => {
    const { service, deleted } = harness({ staff: [staffMember({ id: 'staff-3' })] });

    await service.remove('tenant', 't1', 'created during setup', granted, true);
    expect(deleted).toEqual(['staff-3', 'tenant']);
  });

  /**
   * Clinical data is not a permission anybody holds. The owner is the most
   * privileged caller there is and is refused exactly as everyone else.
   */
  it.each([
    ['visits', { PrescriptionRequest: 4 }],
    ['encounters', { Encounter: 1 }],
    ['invoices', { Invoice: 2 }],
    ['clinician payments', { ProviderEarning: 7 }],
  ])('refuses the owner outright when the tenant has %s', async (_label, counts) => {
    const { service, deleted } = harness({ counts, staff: [staffMember()] });

    await expect(
      service.remove('tenant', 't1', 'tidying up', OWNER, true),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleted).toEqual([]);
  });

  describe('accounts that are never taken', () => {
    it.each([
      ['an owner', staffMember({ id: 'other', role: Role.OWNER }), OWNER, /never deleted/],
      ['the caller themselves', staffMember({ id: OWNER.id }), OWNER, /your own account/],
      ['a super admin, to a super admin', staffMember({ id: 'sa', role: Role.SUPER_ADMIN }), granted, /only an owner/],
    ])('refuses %s', async (_label, member, actor, message) => {
      const { service, deleted } = harness({ staff: [member] });

      await expect(service.remove('tenant', 't1', 'cleaning up', actor, true)).rejects.toThrow(
        message,
      );
      expect(deleted).toEqual([]);
    });

    it.each([
      ['wrote a clinical note', { note: 2 }, /clinical note/],
      ['sent a message', { message: 5 }, /message/],
      ['sat in a patient conversation', { participant: 1 }, /conversation/],
      ['is a clinician', { profile: 1 }, /clinician account/],
      ['is also a patient', { patient: 1 }, /patient record/],
    ])('refuses an account that %s', async (_label, refs, message) => {
      const { service, deleted } = harness({
        staff: [staffMember({ id: 'staff-x' })],
        references: { 'staff-x': refs },
      });

      await expect(service.remove('tenant', 't1', 'cleaning up', OWNER, true)).rejects.toThrow(
        message,
      );
      expect(deleted).toEqual([]);
    });
  });

  it('recounts inside the transaction and refuses work that arrived meanwhile', async () => {
    let arrived = false;
    const { service, deleted } = harness({
      staff: [staffMember()],
      counts: {},
      onTransaction: (db) => {
        // A visit posted by the client's own server between the check and the
        // delete. The decision to erase was taken before it existed.
        if (!arrived) {
          arrived = true;
          (db as unknown as Record<string, { count: jest.Mock }>).prescriptionRequest.count =
            jest.fn(async () => 1);
        }
      },
    });

    await expect(service.remove('tenant', 't1', 'created during setup', OWNER, true)).rejects.toThrow(
      /1 visit refers to it/,
    );
    expect(deleted).toEqual([]);
  });

  it('records the attempt before acting, and the rollback after it fails', async () => {
    const { service, audit } = harness({
      staff: [staffMember()],
      failDelete: new Error('deadlock detected'),
    });

    await expect(service.remove('tenant', 't1', 'created during setup', OWNER, true)).rejects.toThrow(
      'deadlock detected',
    );

    // Two entries, and the first is never removed: the trail is hash-chained
    // on a monotonic sequence, so retracting an entry would leave a gap that
    // reads as tampering. The second is how the failure gets told.
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record.mock.calls[0][0].after).toMatchObject({ deleted: true });
    expect(audit.record.mock.calls[1][0].after).toMatchObject({ deleted: false, rolledBack: true });
  });

  it('names the staff accounts it removed in the audit entry', async () => {
    const { service, audit } = harness({
      staff: [staffMember({ id: 'staff-7', email: 'ahmed@joeymed.com', isActive: false })],
    });

    await service.remove('tenant', 't1', 'created during setup', OWNER, true);

    expect(audit.record.mock.calls[0][0].after.staffAccountsRemoved).toEqual([
      { id: 'staff-7', email: 'ahmed@joeymed.com', role: Role.ADMIN, wasActive: false },
    ]);
  });
});
