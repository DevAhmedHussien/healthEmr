import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '@/app.module';

/**
 * What the platform owner may change, and what the platform refuses to let them
 * change.
 *
 * The refusals are the point of this file. Anyone can write an endpoint that
 * updates a row; the value is in the cases where it says no — archiving a
 * clinician who still holds open visits, deleting a pharmacy mid-order, voiding
 * an invoice somebody has paid — and in the fact that every one of those
 * decisions lands in a trail that verifies.
 */
describe('super admin governance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let pharmacyId: string;

  /** A pharmacy of our own, so archiving it cannot disturb the demo data. */
  const slug = `e2e-gov-${randomUUID().slice(0, 8)}`;

  /**
   * Visits this suite creates, so it can take them away again.
   *
   * Without it every run leaves a handful of `e2e-*` visits in the console for
   * somebody to wonder about — which is exactly what happened before this
   * existed.
   */
  const created: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = new PrismaClient();

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'super@healthemr.test', password: 'Super!2026' })
      .expect(200);
    token = login.body.tokens.accessToken;

    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'joeyMed' } })).id;
    pharmacyId = (
      await prisma.pharmacy.create({
        data: { slug, name: `E2E Governance Pharmacy ${slug.slice(-4)}`, dispensesBranded: true },
      })
    ).id;
  });

  afterAll(async () => {
    // Signing publishes an event and the pharmacy queues an order off it,
    // asynchronously. Deleting the visit mid-flight makes that write fail on a
    // foreign key — harmless, since dispatch swallows its own errors, but it
    // fills the log with a constraint violation that looks like a real fault.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Visits first: prescriptions, orders and earnings cascade from them.
    for (const id of created) {
      await prisma.prescriptionRequest.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.tenantPharmacy.deleteMany({ where: { pharmacyId } });
    await prisma.pharmacy.delete({ where: { id: pharmacyId } }).catch(() => undefined);
    await prisma.$disconnect();
    await app.close();
  });

  describe('changes are recorded, not just applied', () => {
    it('records what a field changed from and to', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set(auth())
        .send({ contactPhone: '5550001234', statesServed: ['FL', 'GA'] })
        .expect(200);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: 'Pharmacy', entityId: pharmacyId },
        orderBy: { sequence: 'desc' },
      });

      const before = entry?.before as Record<string, unknown>;
      const after = entry?.after as Record<string, unknown>;
      expect(before.contactPhone).toBeNull();
      expect(after.contactPhone).toBe('5550001234');
      expect(after.statesServed).toEqual(['FL', 'GA']);
      expect(entry?.actorUserId).toBeTruthy();
    });

    it('reads the same change back through the activity log', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/super-admin/activity/Pharmacy/${pharmacyId}`)
        .set(auth())
        .expect(200);

      const latest = response.body[0];
      expect(latest.summary).toContain('E2E Governance Pharmacy');
      expect(latest.changes.map((change: { field: string }) => change.field)).toContain('contactPhone');
    });
  });

  describe('a reason is part of the action', () => {
    it('refuses an archive with a token reason', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set(auth())
        .send({ reason: 'because' })
        .expect(400);
      expect(JSON.stringify(response.body.details)).toContain('at least 10 characters');
    });

    it('refuses an archive with no reason at all', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set(auth())
        .send({})
        .expect(400);
    });
  });

  describe('work in flight blocks removal', () => {
    it('will not archive a provider who still holds open visits', async () => {
      const busy = await prisma.prescriptionRequest.findFirst({
        where: { status: { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] }, assignedProviderId: { not: null } },
        select: { assignedProviderId: true },
      });
      if (!busy?.assignedProviderId) return; // nothing open in this dataset

      const response = await request(app.getHttpServer())
        .delete(`/v1/super-admin/providers/${busy.assignedProviderId}`)
        .set(auth())
        .send({ reason: 'Confirming that open work blocks archiving a clinician.' })
        .expect(409);
      expect(response.body.message).toContain('open');

      const provider = await prisma.providerProfile.findUniqueOrThrow({
        where: { id: busy.assignedProviderId },
      });
      expect(provider.status).not.toBe('ARCHIVED');
    });

    it('will not archive a pharmacy with an order in flight', async () => {
      const inFlight = await prisma.pharmacyOrder.findFirst({
        where: { status: { in: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'] } },
        select: { pharmacyId: true },
      });
      if (!inFlight) return;

      const response = await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${inFlight.pharmacyId}`)
        .set(auth())
        .send({ reason: 'Confirming that in-flight orders block archiving a pharmacy.' })
        .expect(409);
      expect(response.body.message).toContain('in flight');
    });
  });

  describe('archiving keeps the record', () => {
    it('archives, deactivates staff, and can be undone', async () => {
      await request(app.getHttpServer())
        .post(`/v1/super-admin/admins/${tenantId}/roster`)
        .set(auth())
        .send({ pharmacyId, reason: 'Attaching for the archive test.' })
        .expect(200);

      const archived = await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set(auth())
        .send({ reason: 'Archiving a pharmacy created purely for this test run.' })
        .expect(200);
      expect(archived.body.status).toBe('ARCHIVED');

      // Off every roster, but still very much on the record.
      const rosterCount = await prisma.tenantPharmacy.count({ where: { pharmacyId } });
      expect(rosterCount).toBe(0);
      await expect(prisma.pharmacy.findUnique({ where: { id: pharmacyId } })).resolves.toBeTruthy();

      // An archived pharmacy cannot be handed new work.
      const reattach = await request(app.getHttpServer())
        .post(`/v1/super-admin/admins/${tenantId}/roster`)
        .set(auth())
        .send({ pharmacyId, reason: 'Should be refused while archived.' })
        .expect(400);
      expect(reattach.body.message).toContain('archived');

      const restored = await request(app.getHttpServer())
        .post(`/v1/super-admin/pharmacies/${pharmacyId}/restore`)
        .set(auth())
        .send({ reason: 'Restoring at the end of the archive test.' })
        .expect(200);
      expect(restored.body.status).toBe('ACTIVE');
      expect(restored.body.archivedAt).toBeNull();
    });

    it('refuses to archive something already archived', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set(auth())
        .send({ reason: 'Archiving once so the second attempt can be checked.' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set(auth())
        .send({ reason: 'Second attempt, which should be refused as a conflict.' })
        .expect(409);

      await request(app.getHttpServer())
        .post(`/v1/super-admin/pharmacies/${pharmacyId}/restore`)
        .set(auth())
        .send({ reason: 'Restoring after the double-archive check.' })
        .expect(200);
    });
  });

  describe('the money is attributable', () => {
    it('reports revenue, cost and fees with the coverage behind the cost', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/super-admin/admins/${tenantId}/profile`)
        .set(auth())
        .expect(200);

      const { money } = response.body;
      expect(money.marginCents).toBe(money.revenueCents - money.costOfGoodsCents - money.providerFeesCents);
      expect(money.costCoverage).toBeGreaterThanOrEqual(0);
      expect(money.costCoverage).toBeLessThanOrEqual(1);
    });

    it('counts only lines a clinician actually prescribed as revenue', async () => {
      const [report, quotedTotal] = await Promise.all([
        request(app.getHttpServer()).get('/v1/super-admin/reports/revenue').set(auth()).expect(200),
        prisma.prescriptionRequestItem.aggregate({
          where: { quotedPriceCents: { not: null } },
          _sum: { quotedPriceCents: true },
        }),
      ]);

      const prescribed = await prisma.prescriptionRequestItem.aggregate({
        where: { quotedPriceCents: { not: null }, decision: { in: ['APPROVED', 'MODIFIED'] } },
        _sum: { quotedPriceCents: true },
      });

      expect(report.body.totals.revenueCents).toBe(prescribed._sum.quotedPriceCents ?? 0);
      // And it is genuinely narrower than "every line anyone ever quoted".
      expect(report.body.totals.revenueCents).toBeLessThanOrEqual(quotedTotal._sum.quotedPriceCents ?? 0);
    });

    it('exports a report as CSV with quoting intact', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/super-admin/reports/cost-of-goods?format=csv')
        .set(auth())
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('cost-of-goods.csv');
      const [header] = response.text.split('\n');
      expect(header).toContain('pharmacy');
      expect(header).toContain('coverage');
    });
  });

  describe('withdrawing a visit', () => {
    /**
     * A visit of our own to withdraw.
     *
     * Built directly rather than posted through intake: this suite is about what
     * withdrawal does to the books, and routing a visit to a real clinician to
     * get one would make the test depend on who happens to have capacity.
     */
    async function makeVisit(withOrderStatus?: 'QUEUED' | 'SHIPPED') {
      const patient = await prisma.patient.findFirstOrThrow({
        where: { tenantLinks: { some: { tenantId } } },
        select: { id: true },
      });
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'weightloss' } });

      const submission = await prisma.qaSubmission.create({
        data: {
          tenantId,
          patientId: patient.id,
          categoryId: category.id,
          patientStateAtSubmission: 'AZ',
          templateVersion: 1,
          valuesJson: {},
        },
        select: { id: true },
      });

      const visit = await prisma.prescriptionRequest.create({
        data: {
          tenantId,
          externalMasterId: `e2e-void-${randomUUID().slice(0, 8)}`,
          qaSubmissionId: submission.id,
          patientId: patient.id,
          categoryId: category.id,
          status: 'APPROVED',
          decidedAt: new Date(),
        },
        select: { id: true },
      });
      // Tracked the moment it exists, so a failure part-way through the rest of
      // this helper still leaves something for afterAll to remove.
      created.push(visit.id);

      if (!withOrderStatus) return visit.id;

      const medication = await prisma.medication.findFirstOrThrow({ where: { isActive: true } });
      const item = await prisma.prescriptionRequestItem.create({
        data: {
          requestId: visit.id,
          medicationId: medication.id,
          nameText: 'E2E line',
          strength: '1mg',
          quantity: '1',
          refills: '0',
          decision: 'APPROVED',
        },
        select: { id: true },
      });

      const provider = await prisma.providerProfile.findFirstOrThrow({ select: { id: true } });
      const pharmacy = await prisma.pharmacy.findFirstOrThrow({
        where: { slug: 'first-choice' },
        select: { id: true },
      });

      const prescription = await prisma.prescription.create({
        data: {
          tenantId,
          requestId: visit.id,
          requestItemId: item.id,
          patientId: patient.id,
          providerId: provider.id,
          medicationId: medication.id,
          sig: 'E2E',
          dose: '1mg',
          quantity: '1',
          refills: 0,
          signedAt: new Date(),
          providerNameSnapshot: 'E2E',
          licenseNumberSnapshot: 'E2E-000',
          licenseStateSnapshot: 'AZ',
        },
        select: { id: true },
      });

      await prisma.pharmacyOrder.create({
        data: {
          tenantId,
          prescriptionId: prescription.id,
          pharmacyId: pharmacy.id,
          status: withOrderStatus,
        },
      });

      return visit.id;
    }

    it("takes the visit out of the client's own lists", async () => {
      const visitId = await makeVisit();

      const admin = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'admin@joeymed.test', password: 'Admin!2026' })
        .expect(200);
      const asAdmin = { Authorization: `Bearer ${admin.body.tokens.accessToken}` };

      const before = await request(app.getHttpServer())
        .get(`/v1/admin/visits/${visitId}`)
        .set(asAdmin)
        .expect(200);
      expect(before.body.id).toBe(visitId);

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set(auth())
        .send({ reason: 'Client asked for this duplicate submission to be removed.' })
        .expect(200);

      // Not "hidden but still 200 with a flag": gone.
      await request(app.getHttpServer())
        .get(`/v1/admin/visits/${visitId}`)
        .set(asAdmin)
        .expect(404);
    });

    it('refuses without a reason, and refuses twice', async () => {
      const visitId = await makeVisit();

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set(auth())
        .send({ reason: 'too short' })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set(auth())
        .send({ reason: 'Withdrawn at the client business request, ticket 4471.' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set(auth())
        .send({ reason: 'Withdrawn at the client business request, ticket 4471.' })
        .expect(400);
    });

    it('will not withdraw a visit whose medication has already shipped', async () => {
      const visitId = await makeVisit('SHIPPED');

      const response = await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set(auth())
        .send({ reason: 'Client asked to remove this one after it went out.' })
        .expect(400);

      expect(response.body.message).toMatch(/already shipped/i);
    });

    it('cancels a queued order and voids the provider fee', async () => {
      const visitId = await makeVisit('QUEUED');

      const provider = await prisma.providerProfile.findFirstOrThrow({ select: { id: true } });
      await prisma.providerEarning.create({
        data: {
          tenantId,
          requestId: visitId,
          providerId: provider.id,
          amountCents: 500,
          status: 'PENDING',
          outcome: 'APPROVED',
          earnedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set(auth())
        .send({ reason: 'Client asked for this test submission to be removed.' })
        .expect(200);

      const earnings = await prisma.providerEarning.findMany({
        where: { requestId: visitId },
        select: { status: true },
      });
      expect(earnings.length).toBeGreaterThan(0);
      expect(earnings.every((earning) => earning.status === 'VOID')).toBe(true);

      const orders = await prisma.pharmacyOrder.findMany({
        where: { prescription: { requestId: visitId } },
        select: { status: true },
      });
      expect(orders.every((order) => order.status === 'CANCELLED')).toBe(true);
    });

    it('is not something a client business can do to its own visits', async () => {
      const visitId = await makeVisit();

      const admin = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'admin@joeymed.test', password: 'Admin!2026' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/visits/${visitId}`)
        .set({ Authorization: `Bearer ${admin.body.tokens.accessToken}` })
        .send({ reason: 'Trying to remove my own visit from my own bill.' })
        .expect(403);
    });
  });

  describe('rerouting a shipped order', () => {
    /** A prescription with an order at a given status, ready to be moved. */
    async function makeOrder(status: 'QUEUED' | 'SHIPPED') {
      const patient = await prisma.patient.findFirstOrThrow({
        where: { tenantLinks: { some: { tenantId } } },
        select: { id: true },
      });
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'weightloss' } });
      const medication = await prisma.medication.findFirstOrThrow({
        where: { isActive: true, isCompounded: true },
        select: { id: true },
      });
      const from = await prisma.pharmacy.findFirstOrThrow({
        where: { slug: 'first-choice' },
        select: { id: true },
      });
      const provider = await prisma.providerProfile.findFirstOrThrow({ select: { id: true } });

      const submission = await prisma.qaSubmission.create({
        data: {
          tenantId,
          patientId: patient.id,
          categoryId: category.id,
          templateVersion: 1,
          patientStateAtSubmission: 'AZ',
          valuesJson: {},
        },
        select: { id: true },
      });

      const visit = await prisma.prescriptionRequest.create({
        data: {
          tenantId,
          externalMasterId: `e2e-rr-${randomUUID().slice(0, 8)}`,
          qaSubmissionId: submission.id,
          patientId: patient.id,
          categoryId: category.id,
          status: 'APPROVED',
          decidedAt: new Date(),
        },
        select: { id: true },
      });

      const item = await prisma.prescriptionRequestItem.create({
        data: {
          requestId: visit.id,
          medicationId: medication.id,
          nameText: 'E2E reroute line',
          strength: '1mg',
          quantity: '1',
          refills: '0',
          decision: 'APPROVED',
        },
        select: { id: true },
      });

      const prescription = await prisma.prescription.create({
        data: {
          tenantId,
          requestId: visit.id,
          requestItemId: item.id,
          patientId: patient.id,
          providerId: provider.id,
          medicationId: medication.id,
          dose: '1mg',
          quantity: '1',
          refills: 0,
          sig: 'E2E',
          signedAt: new Date(),
          providerNameSnapshot: 'E2E',
          licenseNumberSnapshot: 'E2E-000',
          licenseStateSnapshot: 'AZ',
        },
        select: { id: true },
      });

      await prisma.pharmacyOrder.create({
        data: { tenantId, prescriptionId: prescription.id, pharmacyId: from.id, status },
      });

      return { visitId: visit.id, prescriptionId: prescription.id };
    }

    /** Somewhere that can actually take a compounded order. */
    async function targetPharmacy() {
      const pharmacy = await prisma.pharmacy.findFirstOrThrow({
        where: { slug: 'apex-compounding' },
        select: { id: true },
      });
      return pharmacy.id;
    }

    const move = (prescriptionId: string, pharmacy: string, force?: boolean) =>
      request(app.getHttpServer())
        .post('/v1/super-admin/prescriptions/reroute')
        .set(auth())
        .send({
          prescriptionIds: [prescriptionId],
          pharmacyId: pharmacy,
          reason: 'The first parcel was never delivered to the patient.',
          ...(force === undefined ? {} : { force }),
        })
        .expect(200);

    it('refuses a shipped order by default, and says why', async () => {
      const { visitId, prescriptionId } = await makeOrder('SHIPPED');
      created.push(visitId);

      const { body } = await move(prescriptionId, await targetPharmacy());

      expect(body.moved).toHaveLength(0);
      expect(body.skipped[0].why).toMatch(/already shipped/i);
      // The reason matters more than the refusal: somebody reading this has to
      // understand that a reroute dispatches rather than diverts.
      expect(body.skipped[0].why).toMatch(/second parcel/i);
    });

    it('moves it when a second parcel is confirmed', async () => {
      const { visitId, prescriptionId } = await makeOrder('SHIPPED');
      created.push(visitId);

      const { body } = await move(prescriptionId, await targetPharmacy(), true);

      expect(body.skipped).toHaveLength(0);
      expect(body.moved).toHaveLength(1);
    });

    it('records that it had shipped, so two parcels are explicable later', async () => {
      const { visitId, prescriptionId } = await makeOrder('SHIPPED');
      created.push(visitId);

      await move(prescriptionId, await targetPharmacy(), true);

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'PharmacyOrder', action: 'ORDER_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });
      expect((entry.after as Record<string, unknown>).secondParcelAfter).toBe('SHIPPED');
    });

    it('still refuses a pharmacy that cannot dispense it, force or not', async () => {
      const { visitId, prescriptionId } = await makeOrder('SHIPPED');
      created.push(visitId);

      const retail = await prisma.pharmacy.findFirstOrThrow({
        where: { slug: 'retail-partner' },
        select: { id: true },
      });

      // `force` waives the shipped guard and nothing else. A compounded
      // medication still cannot go to a pharmacy that does not compound.
      const { body } = await move(prescriptionId, retail.id, true);

      expect(body.moved).toHaveLength(0);
      expect(body.skipped[0].why).toMatch(/compounded/i);
    });

    it('needs no confirmation for an order that has not shipped', async () => {
      const { visitId, prescriptionId } = await makeOrder('QUEUED');
      created.push(visitId);

      const { body } = await move(prescriptionId, await targetPharmacy());

      expect(body.skipped).toHaveLength(0);
      expect(body.moved).toHaveLength(1);
    });
  });

  describe('a clinician may only sign what they are credentialed for', () => {
    /**
     * The scenario this exists for: one patient orders a weight-loss medication
     * and a sexual-health one, and the clinician the visit routed to holds only
     * the first. Routing matched on the visit's single `visitType` and never
     * looked at what was actually on it.
     */
    async function visitCarrying(medIds: string[], providerEmail: string) {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'joeyMed' } });
      const provider = await prisma.providerProfile.findFirstOrThrow({
        where: { user: { email: providerEmail } },
        select: { id: true },
      });
      const patient = await prisma.patient.findFirstOrThrow({
        where: { tenantLinks: { some: { tenantId: tenant.id } } },
        select: { id: true },
      });
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'weightloss' } });

      const submission = await prisma.qaSubmission.create({
        data: {
          tenantId: tenant.id,
          patientId: patient.id,
          categoryId: category.id,
          templateVersion: 1,
          patientStateAtSubmission: 'AZ',
          valuesJson: {},
        },
        select: { id: true },
      });

      const visit = await prisma.prescriptionRequest.create({
        data: {
          tenantId: tenant.id,
          externalMasterId: `e2e-scope-${randomUUID().slice(0, 8)}`,
          qaSubmissionId: submission.id,
          patientId: patient.id,
          categoryId: category.id,
          status: 'ASSIGNED',
          assignedProviderId: provider.id,
          assignedAt: new Date(),
        },
        select: { id: true },
      });
      created.push(visit.id);

      const items = [];
      for (const medId of medIds) {
        const medication = await prisma.medication.findFirstOrThrow({ where: { medId } });
        items.push(
          await prisma.prescriptionRequestItem.create({
            data: {
              requestId: visit.id,
              medicationId: medication.id,
              nameText: medication.name,
              strength: '1mg',
              quantity: '1',
              refills: '0',
              decision: 'PENDING',
            },
            select: { id: true },
          }),
        );
      }

      return { visitId: visit.id, items };
    }

    const WEIGHT_LOSS = 'vywhPON4F9DCMuCdncQeGwwCwH0gfVxo';
    const SEXUAL_HEALTH = 'xPG2dL44duNYhFDPkYlXKeSdIbplFRHf';

    /** Holds weight loss and nothing else. */
    const NARROW = 'elena.vasquez@clinic.test';

    const approve = (itemId: string) => ({
      itemId,
      decision: 'APPROVED' as const,
      dose: '1mg',
      route: 'ORAL' as const,
      frequency: 'once daily',
      sig: 'Take one by mouth once daily.',
    });

    async function signIn(email: string) {
      const provider = await prisma.providerProfile.findFirstOrThrow({
        where: { user: { email } },
        select: { userId: true },
      });
      await prisma.user.update({
        where: { id: provider.userId },
        data: { passwordHash: await argon2.hash('Provider!2026', { type: argon2.argon2id }) },
      });

      const login = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email, password: 'Provider!2026' })
        .expect(200);

      return { Authorization: `Bearer ${login.body.tokens.accessToken}` };
    }

    it('refuses to sign a medication outside their categories', async () => {
      const { visitId, items } = await visitCarrying([WEIGHT_LOSS, SEXUAL_HEALTH], NARROW);
      const auth = await signIn(NARROW);

      const response = await request(app.getHttpServer())
        .post(`/v1/clinic/visits/${visitId}/decide`)
        .set(auth)
        .send({ items: items.map((item) => approve(item.id)) })
        .expect(403);

      // The message has to say which medication and what would be needed, or
      // the clinician cannot tell what to do about it.
      expect(response.body.message).toMatch(/not credentialed/i);
      expect(response.body.message).toMatch(/Sexual Health/i);
    });

    it('lets them sign the line they are credentialed for, refusing the other', async () => {
      const { visitId, items } = await visitCarrying([WEIGHT_LOSS, SEXUAL_HEALTH], NARROW);
      const auth = await signIn(NARROW);

      await request(app.getHttpServer())
        .post(`/v1/clinic/visits/${visitId}/decide`)
        .set(auth)
        .send({
          items: [
            approve(items[0].id),
            {
              itemId: items[1].id,
              decision: 'DENIED',
              reason: 'Outside my credentialed scope — please reassign.',
            },
          ],
        })
        .expect(200);

      // Refusing is within anybody's competence: a clinician who spots a
      // medication outside their scope must be able to decline it rather than
      // being unable to answer at all.
      const signed = await prisma.prescription.count({ where: { requestId: visitId } });
      expect(signed).toBe(1);
    });

    it('allows a clinician who holds every category on the visit', async () => {
      const broad = 'dr.reyes@healthemr.test';
      const { visitId, items } = await visitCarrying([WEIGHT_LOSS, SEXUAL_HEALTH], broad);
      const auth = await signIn(broad);

      await request(app.getHttpServer())
        .post(`/v1/clinic/visits/${visitId}/decide`)
        .set(auth)
        .send({ items: items.map((item) => approve(item.id)) })
        .expect(200);

      expect(await prisma.prescription.count({ where: { requestId: visitId } })).toBe(2);
    });
  });

  describe('the trail verifies', () => {
    it('still reconciles after everything this suite did to it', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/super-admin/activity/integrity')
        .set(auth())
        .expect(200);

      expect(response.body.intact).toBe(true);
      expect(response.body.brokenAtSequence).toBeNull();
      expect(response.body.checked).toBeGreaterThan(0);
    });

    it('is not reachable by anyone else', async () => {
      const provider = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'dr.reyes@healthemr.test', password: 'Provider!2026' })
        .expect(200);

      await request(app.getHttpServer())
        .get('/v1/super-admin/activity')
        .set({ Authorization: `Bearer ${provider.body.tokens.accessToken}` })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/v1/super-admin/pharmacies/${pharmacyId}`)
        .set({ Authorization: `Bearer ${provider.body.tokens.accessToken}` })
        .send({ reason: 'A provider should never be able to do this.' })
        .expect(403);
    });
  });
});
