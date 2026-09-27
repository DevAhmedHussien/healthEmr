import { ConflictException } from '@nestjs/common';
import { Role } from '@health-emr/types';
import type { AuthenticatedUser } from '@health-emr/types';
import { ClinicalRecordsService, whyVisitIsFinal } from './clinical-records.service';

/**
 * What may be erased, and what may only be marked.
 *
 * The line is whether a clinician dealt with it. Everything past that line is
 * a medical record with a retention period, and no grant on this platform
 * moves it — which is why the owner appears in these tests being refused.
 */

const OWNER: AuthenticatedUser = {
  id: 'owner-1',
  email: 'owner@healthemr.test',
  role: Role.OWNER,
  tenantId: null,
  permissions: [],
} as unknown as AuthenticatedUser;

const DRAFT = {
  id: 'v1',
  externalMasterId: 'E2E-abc',
  status: 'RECEIVED',
  decidedAt: null,
  voidedAt: null,
  tenantId: 't1',
  patientId: 'p1',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  tenant: { slug: 'joey-okj' },
  _count: { prescriptions: 0 },
};

function harness(
  visit: Record<string, unknown> | null = DRAFT,
  options: { orders?: number; failDelete?: Error; onTransaction?: () => void } = {},
) {
  const deleted: string[] = [];
  const db: Record<string, unknown> = {
    prescriptionRequest: {
      findUnique: jest.fn(async () => visit),
      delete: jest.fn(async () => {
        if (options.failDelete) throw options.failDelete;
        deleted.push('visit');
        return { id: 'v1' };
      }),
    },
    pharmacyOrder: { count: jest.fn(async () => options.orders ?? 0) },
  };

  const raw = {
    ...db,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      options.onTransaction?.();
      return fn(db);
    }),
  };

  const audit = { record: jest.fn() };
  return {
    service: new ClinicalRecordsService({ raw } as never, audit as never),
    audit,
    deleted,
    db,
  };
}

describe('whyVisitIsFinal', () => {
  const base = { status: 'RECEIVED', decidedAt: null, _count: { prescriptions: 0 } };

  it('lets an untouched intake go', () => {
    expect(whyVisitIsFinal(base, 0)).toBeNull();
  });

  it.each([
    ['a decision was recorded', { ...base, decidedAt: new Date() }, 0],
    ['it was approved', { ...base, status: 'APPROVED' }, 0],
    ['it was refused', { ...base, status: 'DENIED' }, 0],
    ['a prescription exists', { ...base, _count: { prescriptions: 1 } }, 0],
    ['it reached a pharmacy', base, 1],
  ])('holds it when %s', (_label, visit, orders) => {
    expect(whyVisitIsFinal(visit, orders)).not.toBeNull();
  });

  /**
   * A refusal is a clinical decision. Somebody read the intake and said no, and
   * the reason they said no is exactly what gets asked about afterwards — so
   * DENIED is retained as firmly as APPROVED.
   */
  it('treats a refusal as a decision, not as an abandoned visit', () => {
    expect(whyVisitIsFinal({ ...base, status: 'DENIED' }, 0)).toMatch(/clinical decision/);
  });

  it.each(['RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'EXPIRED', 'CANCELLED'])(
    'leaves %s erasable while nobody has decided',
    (status) => {
      expect(whyVisitIsFinal({ ...base, status }, 0)).toBeNull();
    },
  );
});

describe('visits', () => {
  it('erases one that never reached a clinician', async () => {
    const { service, deleted } = harness();

    const result = await service.removeVisit('v1', 'posted twice by the client', OWNER);

    expect(result.removed).toBe(true);
    expect(deleted).toEqual(['visit']);
  });

  it('refuses a decided visit, even to an owner', async () => {
    const { service, deleted } = harness({ ...DRAFT, decidedAt: new Date('2026-09-02T00:00:00Z') });

    await expect(service.removeVisit('v1', 'tidying up', OWNER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleted).toEqual([]);
  });

  it('says why on the report, in words a disabled button can carry', async () => {
    const { service } = harness({ ...DRAFT, status: 'APPROVED' });
    const report = await service.inspectVisit('v1');

    expect(report.deletable).toBe(false);
    expect(report.finalised).toBe(true);
    expect(report.reason).toBe('it was approved');
    expect(report.alternative).toMatch(/Withdraw it instead/);
  });

  it('offers the master id as the phrase to type', async () => {
    const { service } = harness();
    expect((await service.inspectVisit('v1')).confirmPhrase).toBe('E2E-abc');
  });

  it('recounts inside the transaction and refuses a visit decided meanwhile', async () => {
    let decided = false;
    const visit = { ...DRAFT };
    const { service, deleted } = harness(visit, {
      onTransaction: () => {
        // A clinician approved it between the check and the delete.
        if (!decided) {
          decided = true;
          visit.status = 'APPROVED';
        }
      },
    });

    await expect(service.removeVisit('v1', 'posted twice', OWNER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleted).toEqual([]);
  });

  it('records the attempt, then the rollback', async () => {
    const { service, audit } = harness(DRAFT, { failDelete: new Error('foreign key violation') });

    await expect(service.removeVisit('v1', 'posted twice', OWNER)).rejects.toThrow(
      'foreign key violation',
    );

    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record.mock.calls[0][0].after).toMatchObject({ deleted: true });
    expect(audit.record.mock.calls[1][0].after).toMatchObject({ deleted: false, rolledBack: true });
  });
});

describe('prescriptions', () => {
  function prescriptionHarness(row: Record<string, unknown> | null) {
    const db = {
      prescription: {
        findUnique: jest.fn(async () => row),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'rx1',
          status: data.status,
          voidedAt: data.voidedAt,
        })),
      },
    };
    const audit = { record: jest.fn() };
    return {
      service: new ClinicalRecordsService({ raw: db } as never, audit as never),
      audit,
      db,
    };
  }

  const SIGNED = {
    id: 'rx1',
    status: 'SIGNED',
    signedAt: new Date('2026-09-01T00:00:00Z'),
    voidedAt: null,
    tenantId: 't1',
    patientId: 'p1',
    tenant: { slug: 'joey-okj' },
    request: { externalMasterId: 'E2E-abc' },
    orders: [],
  };

  /**
   * There is no draft prescription. `PrescriptionStatus` begins at SIGNED and
   * `signedAt` cannot be null, so a row exists only because a clinician put
   * their name to it — and the honest answer is always the same one.
   */
  it('never reports a prescription as erasable', async () => {
    const { service } = prescriptionHarness(SIGNED);
    const report = await service.inspectPrescription('rx1');

    expect(report.deletable).toBe(false);
    expect(report.finalised).toBe(true);
    expect(report.reason).toMatch(/signed by a clinician/);
  });

  it('withdraws one, recording who and why', async () => {
    const { service, audit, db } = prescriptionHarness(SIGNED);

    await service.archivePrescription('rx1', 'wrong strength entered', OWNER);

    expect(db.prescription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'VOIDED',
          voidedReason: 'wrong strength entered',
          voidedByUserId: OWNER.id,
        }),
      }),
    );
    expect(audit.record.mock.calls[0][0].action).toBe('PRESCRIPTION_VOIDED');
  });

  /**
   * The parcel exists and the patient may already be taking what is in it.
   * Marking the prescription entered-in-error would leave the dispensing record
   * describing something the chart says should never have happened.
   */
  it.each(['SHIPPED', 'DELIVERED'])('refuses to withdraw one already %s', async (status) => {
    const { service, db } = prescriptionHarness({ ...SIGNED, orders: [{ id: 'o1', status }] });

    await expect(
      service.archivePrescription('rx1', 'wrong strength entered', OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.prescription.update).not.toHaveBeenCalled();
  });

  it('allows withdrawal while the order is still with the pharmacy', async () => {
    const { service, db } = prescriptionHarness({
      ...SIGNED,
      orders: [{ id: 'o1', status: 'IN_FULFILMENT' }],
    });

    await service.archivePrescription('rx1', 'wrong strength entered', OWNER);
    expect(db.prescription.update).toHaveBeenCalled();
  });

  it('puts a withdrawn one back', async () => {
    const { service, db } = prescriptionHarness({
      ...SIGNED,
      voidedAt: new Date('2026-09-05T00:00:00Z'),
      voidedReason: 'withdrawn in error',
    });

    await service.restorePrescription('rx1', OWNER);
    expect(db.prescription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SIGNED', voidedAt: null }) }),
    );
  });
});
