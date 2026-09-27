import { BadRequestException } from '@nestjs/common';
import { ManualAssignmentService } from './manual-assignment.service';

/**
 * The gates on a hand-placed visit.
 *
 * This endpoint exists to override the routing engine, so the question worth
 * testing is what it refuses to override. Licence and credentialling are the
 * law and hold against the highest privilege in the system; capacity is a limit
 * we set ourselves, and overriding it is the entire point.
 */
describe('ManualAssignmentService', () => {
  const future = new Date(Date.now() + 365 * 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  const visit = {
    id: 'visit-1',
    patientId: 'patient-1',
    categoryId: 'cat-ed',
    assignedProviderId: null,
    patient: { residenceState: 'FL' },
    submission: { patientStateAtSubmission: 'FL' },
    items: [{ medicationId: 'med-1' }],
  };

  const provider = (overrides: Record<string, unknown> = {}) => ({
    id: 'provider-1',
    status: 'ACTIVE',
    user: { email: 'dr@example.test' },
    licenses: [{ status: 'ACTIVE', expiresAt: future }],
    categories: [{ categoryId: 'cat-ed' }],
    ...overrides,
  });

  const build = (found: ReturnType<typeof provider> | null) => {
    const update = jest.fn();
    const updateMany = jest.fn();
    const createAttempt = jest.fn();
    const prisma = {
      raw: {
        prescriptionRequest: { findUnique: jest.fn().mockResolvedValue(visit), update },
        providerProfile: { findUnique: jest.fn().mockResolvedValue(found) },
        prescriptionRequestItem: { updateMany },
        routingAttempt: { create: createAttempt },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
          fn({
            prescriptionRequest: { update },
            prescriptionRequestItem: { updateMany },
            routingAttempt: { create: createAttempt },
          }),
        ),
      },
    };
    const audit = { record: jest.fn() };
    const entitlements = {
      categoriesForMedications: jest.fn().mockResolvedValue(new Map([['med-1', ['cat-ed']]])),
    };
    const service = new ManualAssignmentService(
      prisma as never,
      audit as never,
      entitlements as never,
    );
    return { service, update, updateMany, audit, createAttempt };
  };

  const assign = (found: ReturnType<typeof provider> | null) => {
    const harness = build(found);
    return {
      ...harness,
      run: () =>
        harness.service.assign('visit-1', 'provider-1', 'a reason long enough', 'operator-1'),
    };
  };

  it('places a clinician who is licensed and credentialled', async () => {
    const { run, update, updateMany, audit } = assign(provider());
    await expect(run()).resolves.toMatchObject({ assigned: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ASSIGNED' }) }),
    );
    // Every line, not just the visit: the lines are what a clinician decides on.
    expect(updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ after: expect.objectContaining({ manual: true }) }),
    );
  });

  it('refuses a clinician with no licence in the patient’s state', async () => {
    const { run, update } = assign(provider({ licenses: [] }));
    await expect(run()).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a licence that has expired', async () => {
    const { run } = assign(provider({ licenses: [{ status: 'ACTIVE', expiresAt: past }] }));
    await expect(run()).rejects.toThrow(/expired/i);
  });

  it('refuses a licence the clinician added but nobody has checked', async () => {
    const { run } = assign(provider({ licenses: [{ status: 'PENDING', expiresAt: future }] }));
    await expect(run()).rejects.toThrow(/pending/i);
  });

  it('refuses a suspended licence', async () => {
    const { run } = assign(provider({ licenses: [{ status: 'SUSPENDED', expiresAt: future }] }));
    await expect(run()).rejects.toThrow(/suspended/i);
  });

  it('refuses a clinician not credentialled for the treatment', async () => {
    const { run } = assign(provider({ categories: [{ categoryId: 'cat-hairloss' }] }));
    await expect(run()).rejects.toThrow(/credentialled/i);
  });

  it('refuses a clinician who is not active', async () => {
    const { run } = assign(provider({ status: 'SUSPENDED' }));
    await expect(run()).rejects.toThrow(/not active/i);
  });

  // The one limit this endpoint is meant to override. A clinician at capacity
  // is why a visit is waiting, so refusing here would make the feature useless.
  it('places a clinician who is over capacity, which is the point', async () => {
    const { run } = assign(provider());
    await expect(run()).resolves.toMatchObject({ assigned: true });
  });

  it('will not place a visit that already has somebody', async () => {
    const harness = build(provider());
    harness.service['prisma'].raw.prescriptionRequest.findUnique = jest
      .fn()
      .mockResolvedValue({ ...visit, assignedProviderId: 'someone-else' });
    await expect(
      harness.service.assign('visit-1', 'provider-1', 'a reason long enough', 'operator-1'),
    ).rejects.toThrow(/already has a clinician/i);
  });
});
