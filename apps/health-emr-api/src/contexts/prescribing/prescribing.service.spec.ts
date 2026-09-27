import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrescribingService } from './prescribing.service';

/**
 * Signing a prescription is the one irreversible clinical act in the system, so
 * every guard around it gets a test.
 */
describe('PrescribingService.decide', () => {
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const item = (id: string, medicationId = 'med-1', assignedProviderId: string | null = 'prov-1') => ({
    id,
    medicationId,
    assignedProviderId,
    decision: 'PENDING',
    decisionReason: null,
    nameText: 'Semaglutide',
    strength: '2.5mg/mL',
    quantity: '1',
    refills: '3',
    daysSupply: '30',
  });

  const build = (
    over: {
      request?: any;
      licences?: any[];
      holds?: any[];
      medicationCategories?: any[];
      /** `null` removes the signature, for the test that signing refuses without one. */
      signature?: string | null;
    } = {},
  ) => {
    const request = over.request ?? {
      id: 'req-1',
      tenantId: 'ten-1',
      patientId: 'pat-1',
      externalMasterId: 'M-1',
      assignedProviderId: 'prov-1',
      status: 'ASSIGNED',
      items: [item('item-1')],
      submission: { patientStateAtSubmission: 'TX' },
    };

    const tx = {
      prescriptionRequestItem: { update: jest.fn().mockResolvedValue({}) },
      prescription: { create: jest.fn().mockResolvedValue({ id: 'rx-1' }) },
      prescriptionRequest: { update: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      raw: {
        prescriptionRequest: { findUnique: jest.fn().mockResolvedValue(request) },
        providerProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'prov-1',
            user: { firstName: 'Ndidi', lastName: 'Okafor' },
            // A clinician who cannot sign is not the subject of these tests, so
            // the fixture has a signature by default. `over.signature: null`
            // takes it away for the test that checks signing is refused.
            signatureImage:
              over.signature === null ? null : (over.signature ?? 'phi.v1:fixture-signature'),
            signatureName: over.signature === null ? null : 'Ndidi Okafor, MD',
            licenses:
              over.licences ??
              [{ licenseNumber: 'TX-23456', state: 'TX', status: 'ACTIVE', expiresAt: future }],
          }),
        },
        // The credential check at signing. Defaults to a clinician who holds
        // the category every fixture medication belongs to; the credentialing
        // tests below override them.
        providerCategory: {
          findMany: jest.fn().mockResolvedValue(over.holds ?? [{ categoryId: 'cat-weightloss' }]),
        },
        categoryMedication: {
          findMany: jest.fn().mockResolvedValue(
            over.medicationCategories ?? [
              {
                medicationId: 'med-1',
                categoryId: 'cat-weightloss',
                category: { name: 'Weight Loss' },
              },
            ],
          ),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      },
    };

    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const events = { publish: jest.fn() };
    const earnings = { recordForReview: jest.fn().mockResolvedValue(undefined) };
    // Decryption is exercised in the crypto spec; here it only has to be present.
    const phi = { decrypt: (value: string) => value, encrypt: (value: string) => value };

    return {
      service: new PrescribingService(
        prisma as any,
        audit as any,
        events as any,
        earnings as any,
        phi as any,
        { get: jest.fn() } as any,
        // Asking the patient a question goes through messaging; nothing in
        // these tests takes that path.
        { openPatientThread: jest.fn(), postSystemMessage: jest.fn() } as any,
      ),
      prisma,
      tx,
      audit,
      events,
      earnings,
    };
  };

  const approve = (itemId = 'item-1') => ({
    items: [{ itemId, decision: 'APPROVED' as const, sig: 'Inject weekly' }],
  });

  it('signs an approved line and records the provider and licence as they were', async () => {
    const { service, tx } = build();

    const result = await service.decide({
      requestId: 'req-1',
      providerId: 'prov-1',
      actingUserId: 'user-1',
      input: approve(),
    });

    expect(result.status).toBe('APPROVED');
    expect(result.prescriptionIds).toEqual(['rx-1']);
    expect(tx.prescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerNameSnapshot: 'Ndidi Okafor',
          licenseNumberSnapshot: 'TX-23456',
          licenseStateSnapshot: 'TX',
          refills: 3,
          daysSupply: 30,
          sig: 'Inject weekly',
          status: 'SIGNED',
        }),
      }),
    );
  });

  it('puts the clinician’s signature on the prescription, frozen as it was', async () => {
    const { service, tx } = build();

    await service.decide({
      requestId: 'req-1',
      providerId: 'prov-1',
      actingUserId: 'user-1',
      input: approve(),
    });

    // Copied straight across, still encrypted: it never needs to be readable
    // between the profile and the prescription.
    expect(tx.prescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signatureSnapshot: 'phi.v1:fixture-signature',
          signatureNameSnapshot: 'Ndidi Okafor, MD',
        }),
      }),
    );
  });

  it('refuses to sign at all when the clinician has no signature on file', async () => {
    const { service, tx } = build({ signature: null });

    await expect(
      service.decide({
        requestId: 'req-1',
        providerId: 'prov-1',
        actingUserId: 'user-1',
        input: approve(),
      }),
    ).rejects.toThrow(/signature/i);

    // Refused before anything is written: a half-signed visit would be worse
    // than one that never started.
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('refuses a provider the visit is not assigned to', async () => {
    const { service } = build();
    await expect(
      service.decide({ requestId: 'req-1', providerId: 'someone-else', actingUserId: 'u', input: approve() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the licence lapsed between assignment and signature', async () => {
    const { service } = build({ licences: [] });
    await expect(
      service.decide({ requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u', input: approve() }),
    ).rejects.toThrow(/no longer hold an active licence in TX/);
  });

  it('refuses a partial review', async () => {
    const { service } = build({
      request: {
        id: 'req-1', tenantId: 'ten-1', patientId: 'pat-1', externalMasterId: 'M-1',
        assignedProviderId: 'prov-1', status: 'ASSIGNED',
        items: [item('item-1'), item('item-2', 'med-2')],
        submission: { patientStateAtSubmission: 'TX' },
      },
    });

    await expect(
      service.decide({ requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u', input: approve() }),
    ).rejects.toThrow(/Every line must be decided/);
  });

  it('refuses a line that belongs to another visit', async () => {
    const { service } = build();
    await expect(
      service.decide({
        requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u',
        input: approve('item-from-elsewhere'),
      }),
    ).rejects.toThrow(/does not belong to this visit/);
  });

  it('refuses to decide a visit twice', async () => {
    const { service } = build({
      request: {
        id: 'req-1', tenantId: 'ten-1', patientId: 'pat-1', externalMasterId: 'M-1',
        assignedProviderId: 'prov-1', status: 'APPROVED',
        items: [item('item-1')], submission: { patientStateAtSubmission: 'TX' },
      },
    });
    await expect(
      service.decide({ requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u', input: approve() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates no prescription when every line is denied, and needs no licence', async () => {
    const { service, tx, prisma } = build({ licences: [] });

    const result = await service.decide({
      requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u',
      input: { items: [{ itemId: 'item-1', decision: 'DENIED', reason: 'Contraindicated' }] },
    });

    expect(result.status).toBe('DENIED');
    expect(result.prescriptionIds).toEqual([]);
    expect(tx.prescription.create).not.toHaveBeenCalled();
    expect(prisma.raw.providerProfile.findUnique).not.toHaveBeenCalled();
  });

  it('signs a modified line using the provider’s values, not the patient’s', async () => {
    const { service, tx } = build();

    await service.decide({
      requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u',
      input: {
        items: [{
          itemId: 'item-1', decision: 'MODIFIED', sig: 'Inject weekly',
          approvedStrength: '5mg/mL', approvedRefills: '1',
          reason: 'Lower starting strength',
        }],
      },
    });

    expect(tx.prescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dose: '5mg/mL', refills: 1 }),
      }),
    );
  });

  it('raises when the visit does not exist', async () => {
    const { service, prisma } = build();
    prisma.raw.prescriptionRequest.findUnique.mockResolvedValue(null);
    await expect(
      service.decide({ requestId: 'nope', providerId: 'prov-1', actingUserId: 'u', input: approve() }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pays the provider for the review, approved or denied', async () => {
    // Paying only for approvals would give a provider a financial reason to
    // approve something that should be declined, so both paths record earnings.
    const approved = build();
    await approved.service.decide({
      requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u', input: approve(),
    });
    expect(approved.earnings.recordForReview).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', providerId: 'prov-1', outcome: 'APPROVED' }),
    );

    const denied = build({ licences: [] });
    await denied.service.decide({
      requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u',
      input: { items: [{ itemId: 'item-1', decision: 'DENIED', reason: 'Contraindicated' }] },
    });
    expect(denied.earnings.recordForReview).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'DENIED' }),
    );
  });

  it('audits the decision and the signature separately', async () => {
    const { service, audit, events } = build();
    await service.decide({ requestId: 'req-1', providerId: 'prov-1', actingUserId: 'u', input: approve() });

    const actions = audit.record.mock.calls.map((call) => call[0].action);
    expect(actions).toContain('REQUEST_DECIDED');
    expect(actions).toContain('PRESCRIPTION_SIGNED');

    const published = events.publish.mock.calls.map((call) => call[0]);
    expect(published).toContain('prescription.signed');
    expect(published).toContain('visit.approved');
  });

  /**
   * A visit put on hold has to come back on its own.
   *
   * Otherwise the clinician has to remember to go and look, and an answer that
   * arrives while they are with somebody else costs the patient a day.
   */
  describe('when the patient answers', () => {
    const build2 = () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        raw: {
          chatThread: { findUnique: jest.fn().mockResolvedValue({ patientId: 'pat-1' }) },
          prescriptionRequest: { updateMany },
        },
      };
      const service = new PrescribingService(
        prisma as never,
        { record: jest.fn() } as never,
        { publish: jest.fn() } as never,
        { recordForReview: jest.fn() } as never,
        {} as never,
        { get: jest.fn() } as never,
        {} as never,
      );
      return { service, updateMany };
    };

    const envelope = (authorRole: string) => ({
      event: 'chat.message' as never,
      tenantId: null,
      requestId: null,
      occurredAt: new Date().toISOString(),
      payload: { threadId: 'thread-1', authorRole },
    });

    it('brings their visit back to the clinician', async () => {
      const { service, updateMany } = build2();
      await service.onPatientReplied(envelope('PATIENT') as never);

      expect(updateMany).toHaveBeenCalledWith({
        where: { patientId: 'pat-1', status: 'INFO_REQUESTED', voidedAt: null },
        // IN_REVIEW, not ASSIGNED: the clinician had already opened it, and
        // sending it back to the top of the pile would lose that.
        data: { status: 'IN_REVIEW' },
      });
    });

    it('ignores the clinician answering themselves', async () => {
      const { service, updateMany } = build2();
      await service.onPatientReplied(envelope('PROVIDER') as never);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  /**
   * A visit whose medications span categories no single clinician covers is
   * shared out line by line. Each reviewer answers for their own lines only,
   * and the visit resolves once — when the last line is decided.
   */
  describe('a visit shared between two clinicians', () => {
    const shared = () => ({
      id: 'req-1',
      tenantId: 'ten-1',
      patientId: 'pat-1',
      externalMasterId: 'M-1',
      // The lead. The other clinician holds a line but is not named here.
      assignedProviderId: 'prov-1',
      status: 'ASSIGNED',
      items: [item('item-wl', 'med-1', 'prov-1'), item('item-ed', 'med-2', 'prov-2')],
      submission: { patientStateAtSubmission: 'TX' },
    });

    const categories = [
      { medicationId: 'med-1', categoryId: 'cat-weightloss', category: { name: 'Weight Loss' } },
      { medicationId: 'med-2', categoryId: 'cat-ed', category: { name: 'Sexual Health' } },
    ];

    it('does not ask a clinician to decide a line that is not theirs', async () => {
      const { service } = build({ request: shared(), medicationCategories: categories });

      // Only the weight-loss line is mine, and deciding it is enough.
      await expect(
        service.decide({
          requestId: 'req-1',
          providerId: 'prov-1',
          actingUserId: 'u',
          input: approve('item-wl'),
        }),
      ).resolves.toMatchObject({ awaitingOtherClinician: true });
    });

    it('refuses a decision on a colleague\'s line', async () => {
      const { service } = build({ request: shared(), medicationCategories: categories });

      await expect(
        service.decide({
          requestId: 'req-1',
          providerId: 'prov-1',
          actingUserId: 'u',
          input: approve('item-ed'),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('leaves the visit open until the second clinician has decided', async () => {
      const { service, tx, events } = build({
        request: shared(),
        medicationCategories: categories,
      });

      const result = await service.decide({
        requestId: 'req-1',
        providerId: 'prov-1',
        actingUserId: 'u',
        input: approve('item-wl'),
      });

      expect(result.status).toBe('IN_REVIEW');
      expect(tx.prescriptionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'IN_REVIEW' }) }),
      );
      // The client must not be told the visit is approved while a second
      // medication is still under review.
      expect(events.publish.mock.calls.map((call) => call[0])).not.toContain('visit.approved');
    });

    it('resolves the visit when the last line is decided', async () => {
      const request = shared();
      request.items[0] = { ...request.items[0], decision: 'APPROVED' };

      const { service, tx, events } = build({ request, medicationCategories: categories });

      const result = await service.decide({
        requestId: 'req-1',
        providerId: 'prov-2',
        actingUserId: 'u',
        input: { items: [{ itemId: 'item-ed', decision: 'DENIED', reason: 'Contraindicated' }] },
      });

      // Denied their own line, but the visit as a whole approved something.
      expect(result.status).toBe('APPROVED');
      expect(tx.prescriptionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
      expect(events.publish.mock.calls.map((call) => call[0])).toContain('visit.approved');
    });

    it('pays each clinician for the lines they reviewed', async () => {
      const { service, earnings } = build({ request: shared(), medicationCategories: categories });

      await service.decide({
        requestId: 'req-1',
        providerId: 'prov-1',
        actingUserId: 'u',
        input: approve('item-wl'),
      });

      expect(earnings.recordForReview).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'prov-1', outcome: 'APPROVED' }),
      );
    });
  });
});
