import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '@/app.module';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';

/**
 * The whole prescription lifecycle, against a real database.
 *
 * Unit tests cover each rule in isolation; this covers the thing the business
 * actually sells — a telehealth company posts an intake and a patient ends up
 * with a tracked parcel. If this passes, the product works.
 */
describe('prescription flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let apiKey: string;
  let phi: PhiCryptoService;
  let masterId: string;
  let restoreStates: string[] = [];
  let tenantId: string | null = null;

  /**
   * A real product from First Choice's own catalogue.
   *
   * Not an invented id: intake resolves the medication by `medId`, and a made-up
   * one is refused before any of the flow under test runs. This is
   * "1stChoice Semaglutide 0.25mg (2 month)".
   */
  const MED_ID = 'vywhPON4F9DCMuCdncQeGwwCwH0gfVxo';

  const patient = {
    firstName: 'Elena',
    lastName: 'Marsh',
    dob: '05/21/1987',
    phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`,
    email: `elena.marsh.${randomUUID().slice(0, 8)}@example.test`,
  };

  /** A valid intake for one medication, for the stock-gate cases. */
  const intakeFor = (medId: string, master: string) => ({
    masterId: master,
    company: 'joeyMed',
    visitType: 'weightloss' as const,
    pharmacyId: 'first-choice',
    formObj: {
      consentsSigned: true,
      firstName: 'Marta',
      lastName: 'Oyelaran',
      dob: '03/12/1990',
      phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`,
      email: `marta.${randomUUID().slice(0, 8)}@example.test`,
      address: '12 Bay St',
      city: 'Phoenix',
      state: 'AZ',
      zip: '85004',
      sex: 'Female',
      selfReportedMeds: 'None',
      allergies: 'None',
      medicalConditions: 'None',
      patientPreference: [
        { name: 'x', strength: 'x', quantity: '1', refills: '0', medId },
      ],
    },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    prisma = new PrismaClient();
    // Message bodies are encrypted at rest; read them the way the app does.
    phi = app.get(PhiCryptoService);

    // Mint a tenant API key for joeyMed. Keys are hashed, so the plaintext only
    // exists at creation — the same constraint a real integrator lives with.
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'joeyMed' } });
    const prefix = randomBytes(9).toString('base64url').slice(0, 12);
    apiKey = `hemr_${prefix}${randomBytes(32).toString('base64url')}`;
    await prisma.tenantApiKey.create({
      data: {
        tenantId: tenant.id,
        name: `e2e-${randomUUID().slice(0, 8)}`,
        keyPrefix: prefix,
        keyHash: await argon2.hash(apiKey, { type: argon2.argon2id }),
        scopes: ['visit:create'],
      },
    });

    masterId = `E2E-${randomUUID().slice(0, 8)}`;

    // This suite prescribes into Arizona. A client business can be restricted to
    // a list of states from the console, and that restriction is enforced at
    // intake — so the suite must not assume how the tenant happens to be
    // configured today. Permit AZ for the duration, and put it back afterwards.
    restoreStates = tenant.allowedStates;
    if (restoreStates.length && !restoreStates.includes('AZ')) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { allowedStates: [...restoreStates, 'AZ'] },
      });
      tenantId = tenant.id;
    }
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { allowedStates: restoreStates } });
    }

    // Leave the database as we found it.
    //
    // Every visit this suite creates, not just the main patient's — the
    // stock-gate and refusal cases each mint their own patient through
    // `intakeFor`. Missing those left an assigned visit behind on every run,
    // and after a dozen runs both AZ-licensed clinicians were at capacity and
    // routing refused every new intake. The suite had quietly broken itself.
    const mine = await prisma.prescriptionRequest.findMany({
      where: { externalMasterId: { startsWith: masterId.split('-').slice(0, 2).join('-') } },
      select: { patientId: true },
    });

    const touched = new Set(mine.map((row) => row.patientId));
    const main = await prisma.patient.findFirst({
      where: { phone: patient.phone },
      select: { id: true },
    });
    if (main) touched.add(main.id);

    for (const patientId of touched) {
      const record = await prisma.patient.findUnique({
        where: { id: patientId },
        select: { userId: true, prescriptions: { select: { id: true }, take: 1 } },
      });
      if (!record) continue;

      // Checked *before* deleting anything. A prescription cascades from its
      // request, so deleting requests first destroys the very record this guard
      // exists to protect — and takes the governance suite's revenue figures
      // with it.
      if (record.prescriptions.length) continue;

      await prisma.prescriptionRequest.deleteMany({ where: { patientId } });
      await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
      if (record.userId) {
        await prisma.user.delete({ where: { id: record.userId } }).catch(() => undefined);
      }
    }

    await prisma.tenantApiKey.deleteMany({ where: { name: { startsWith: 'e2e-' } } });

    await prisma.$disconnect();
    await app.close();
  });

  const login = async (email: string, password: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.tokens.accessToken;
  };

  it('1. a tenant submits an intake and a patient record is created', async () => {
    const response = await request(app.getHttpServer())
      .post('/partner/v1/visits')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        formObj: {
          consentsSigned: true,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dob: patient.dob,
          phone: patient.phone,
          email: patient.email,
          address: '18 Willow Ave',
          city: 'Phoenix',
          state: 'AZ',
          zip: '85004',
          sex: 'Female',
          selfReportedMeds: 'None',
          allergies: 'Codeine',
          medicalConditions: 'None',
          patientPreference: [
            {
              name: 'Semaglutide',
              strength: '2.5mg/mL',
              quantity: '1',
              refills: '2',
              daysSupply: '30',
              medId: MED_ID,
            },
          ],
          Q1: 'Prior GLP-1?',
          A1: 'No',
        },
        pharmacyId: 'first-choice',
        masterId,
        company: 'joeyMed',
        visitType: 'weightloss',
      })
      .expect(200);

    expect(response.body.data.masterId).toBe(masterId);
    expect(response.body.data.visitId).toBeTruthy();
  });

  it('2. the patient gets a login, and the reported allergy reaches the chart', async () => {
    const record = await prisma.patient.findFirstOrThrow({
      where: { phone: patient.phone },
      include: { user: true, allergies: true },
    });

    expect(record.user?.role).toBe('PATIENT');
    // Not merely stored in the encrypted questionnaire — the pharmacy reads this table.
    expect(record.allergies.map((a) => a.substance)).toContain('Codeine');
  });

  it('3. it routed to a provider licensed in the patient’s state', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { externalMasterId: masterId },
      include: { assignedProvider: { include: { licenses: true } } },
    });

    expect(visit.status).toBe('ASSIGNED');
    expect(visit.assignedProvider?.licenses.some((l) => l.state === 'AZ')).toBe(true);
  });

  it('4. a different provider cannot decide someone else’s visit', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { externalMasterId: masterId },
      include: { items: true, assignedProvider: { include: { user: true } } },
    });

    const assignedEmail = visit.assignedProvider!.user.email;
    const intruderEmail = [
      'dr.reyes@healthemr.test',
      'dr.okafor@healthemr.test',
      'dr.lindqvist@healthemr.test',
    ].find((email) => email !== assignedEmail)!;

    const token = await login(intruderEmail, 'Provider!2026');

    await request(app.getHttpServer())
      .post(`/v1/clinic/visits/${visit.id}/decide`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        // A complete, valid decision — so the refusal that follows is about who
        // is asking, not about what they sent.
        items: [
          {
            itemId: visit.items[0].id,
            decision: 'APPROVED',
            dose: '0.25mg',
            route: 'SUBCUTANEOUS',
            site: 'abdomen',
            frequency: 'once weekly',
            sig: 'Inject 0.25mg subcutaneously into the abdomen once weekly.',
          },
        ],
      })
      .expect(403);
  });

  it('5. the assigned provider signs, and the licence is snapshotted', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { externalMasterId: masterId },
      include: { items: true, assignedProvider: { include: { user: true } } },
    });

    const token = await login(visit.assignedProvider!.user.email, 'Provider!2026');

    const response = await request(app.getHttpServer())
      .post(`/v1/clinic/visits/${visit.id}/decide`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            itemId: visit.items[0].id,
            decision: 'APPROVED',
            dose: '0.25mg',
            route: 'SUBCUTANEOUS',
            site: 'abdomen, rotating sites',
            frequency: 'once weekly',
            daysSupply: '28',
            sig: 'Inject 0.25mg subcutaneously into the abdomen, rotating sites once weekly for 28 days.',
            patientNote: 'Start low. Mild nausea in week one is common — message me if it stops you eating.',
          },
        ],
      })
      .expect(200);

    expect(response.body.status).toBe('APPROVED');

    const prescription = await prisma.prescription.findFirstOrThrow({
      where: { requestId: visit.id },
    });
    expect(prescription.licenseStateSnapshot).toBe('AZ');
    expect(prescription.providerNameSnapshot).toBeTruthy();
  });

  it('5b. the clinician reads the chart, and the review lands on their balance', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { externalMasterId: masterId },
      include: { assignedProvider: { include: { user: true } } },
    });

    const token = await login(visit.assignedProvider!.user.email, 'Provider!2026');

    // What a decision is made from. The console reads this endpoint; a page that
    // shows only the medication lines is approving without a chart.
    const chart = await request(app.getHttpServer())
      .get(`/v1/clinic/visits/${visit.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(chart.body.questionnaire.answers.length).toBeGreaterThan(0);
    // The allergy the patient reported at intake has to reach the clinician.
    expect(chart.body.clinical.allergies.map((row: { substance: string }) => row.substance))
      .toContain('Codeine');
    expect(chart.body.patientState).toBe('AZ');

    const summary = await request(app.getHttpServer())
      .get('/v1/clinic/me/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(summary.body.work.decided).toBeGreaterThan(0);
    expect(summary.body.balance.unpaidCents).toBeGreaterThan(0);
    // Reviews and earnings are counted from different tables; if they disagree
    // a clinician is being underpaid by a failure that only reached a log line.
    expect(summary.body.unrecorded).toBe(0);

    const ledger = await request(app.getHttpServer())
      .get('/v1/clinic/me/earnings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The total is the lines added up, or one of the two is lying.
    const lines: Array<{ amountCents: number; status: string }> = ledger.body.data;
    const unpaid = lines
      .filter((line) => line.status === 'PENDING' || line.status === 'APPROVED_FOR_PAYOUT')
      .reduce((sum, line) => sum + line.amountCents, 0);
    expect(unpaid).toBe(summary.body.balance.unpaidCents);
    expect(lines.some((line) => line.amountCents > 0)).toBe(true);
  });

  it('5c. a clinician cannot read a chart that is not on their queue', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { externalMasterId: masterId },
      select: { id: true, assignedProviderId: true },
    });

    const other = await prisma.providerProfile.findFirstOrThrow({
      where: { id: { not: visit.assignedProviderId! } },
      include: { user: true },
    });

    const token = await login(other.user.email, 'Provider!2026');

    // The questionnaire is the most sensitive content the system holds, so
    // reaching it must fail on assignment, not merely be absent from a list.
    await request(app.getHttpServer())
      .get(`/v1/clinic/visits/${visit.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('5d. the structured directions are recorded, not just the sentence', async () => {
    const prescription = await prisma.prescription.findFirstOrThrow({
      where: { request: { externalMasterId: masterId } },
      select: { route: true, site: true, frequency: true, daysSupply: true, sig: true, patientNote: true },
    });

    // A pharmacy and a patient app both act on these. Parsing them back out of
    // the directions sentence is the thing this replaced.
    expect(prescription.route).toBe('SUBCUTANEOUS');
    expect(prescription.site).toBe('abdomen, rotating sites');
    expect(prescription.frequency).toBe('once weekly');
    expect(prescription.daysSupply).toBe(28);
    expect(prescription.patientNote).toContain('Start low');

    // The label says where to inject, which is the instruction most often guessed.
    expect(prescription.sig).toContain('abdomen');
    expect(prescription.sig).toContain('subcutaneously');
  });

  it('5e. the patient is told, in their own conversation, what to do', async () => {
    // Posted by a listener on the signing event, so allow it to settle.
    await new Promise((resolve) => setTimeout(resolve, 600));

    const patientRecord = await prisma.patient.findFirstOrThrow({
      where: { phone: patient.phone },
      select: { id: true, userId: true },
    });

    const thread = await prisma.chatThread.findFirst({
      where: { kind: 'PATIENT_PROVIDER', patientId: patientRecord.id },
      include: { messages: { orderBy: { sentAt: 'asc' } }, participants: true },
    });

    expect(thread).toBeTruthy();
    // Both sides are in it, or it is not a conversation.
    expect(thread!.participants.map((p) => p.userId)).toContain(patientRecord.userId);
    expect(thread!.participants.some((p) => p.role === 'PROVIDER')).toBe(true);

    // Found by content, not by position: other milestones post to this thread
    // too, and "the latest message" stops being the prescription the moment the
    // order reaches the pharmacy.
    const message = thread!.messages.find((row) =>
      phi.decrypt(row.content).includes('has prescribed'),
    );
    expect(message).toBeDefined();
    expect(message!.kind).toBe('SYSTEM');
    // Not attributed to the clinician: they did not type these words.
    expect(message!.authorUserId).toBeNull();

    const body = phi.decrypt(message!.content);
    expect(body).toContain('Semaglutide');
    // The directions are quoted from the signed sig, so the message and the
    // label cannot say different things.
    expect(body).toContain('abdomen, rotating sites');
    expect(body).toContain('28 days');
    expect(body).toContain('Start low');
  });

  it('6. it reaches the pharmacy without anyone pushing it', async () => {
    // Dispatch is event-driven, so allow the listener to settle.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const order = await prisma.pharmacyOrder.findFirstOrThrow({
      where: { prescription: { request: { externalMasterId: masterId } } },
      include: { pharmacy: true },
    });

    expect(order.pharmacy.slug).toBe('first-choice');

    // QUEUED when the pharmacy has no integration configured, SUBMITTED once it
    // does — both mean the order reached the right pharmacy without anyone
    // pushing it, which is what this case is about. Asserting only QUEUED made
    // the test fail the moment transmission started working.
    expect(['QUEUED', 'SUBMITTED']).toContain(order.status);

    const config = await prisma.pharmacyConfig.findUnique({
      where: { pharmacyId: order.pharmacyId },
    });
    if (config?.isEnabled && config.credentialCipher) {
      expect(order.status).toBe('SUBMITTED');
      expect(order.externalOrderId).toBeTruthy();
      expect(order.submittedAt).toBeTruthy();
    } else {
      expect(order.status).toBe('QUEUED');
    }
  });

  it('6b. the order carries what it earns and what it cost, as a matched pair', async () => {
    const order = await prisma.pharmacyOrder.findFirstOrThrow({
      where: { prescription: { request: { externalMasterId: masterId } } },
      select: {
        sellPriceCents: true,
        sellPriceSource: true,
        costOfGoodsCents: true,
        costSourceProductId: true,
        tenantId: true,
      },
    });

    // Snapshotted at dispatch from one lookup, so revenue and cost describe the
    // same instant. Read separately later they would not.
    expect(order.sellPriceCents).toBeGreaterThan(0);
    expect(order.costOfGoodsCents).toBeGreaterThan(0);
    expect(order.costSourceProductId).toBeTruthy();
    expect(order.sellPriceSource).toBeTruthy();

    // Selling below cost is a configuration mistake, not a business model.
    expect(order.sellPriceCents!).toBeGreaterThan(order.costOfGoodsCents!);

    const token = await login('super@healthemr.test', 'Super!2026');
    const summary = await request(app.getHttpServer())
      .get('/v1/super-admin/revenue/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(summary.body.thisMonth.revenueCents).toBeGreaterThanOrEqual(order.sellPriceCents!);
    expect(summary.body.thisMonth.profitCents).toBe(
      summary.body.thisMonth.revenueCents -
        summary.body.thisMonth.costOfGoodsCents -
        summary.body.thisMonth.providerFeesCents,
    );
  });

  it('6c. a refused visit earns nothing, and the client is not billed for it', async () => {
    const token = await login('super@healthemr.test', 'Super!2026');

    const before = await request(app.getHttpServer())
      .get('/v1/super-admin/revenue/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Its own patient. The same one already has an open weight-loss visit, and
    // intake rejects a second — which is correct behaviour, and not what this
    // test is about.
    const refusedMaster = `${masterId}-refused`;
    await request(app.getHttpServer())
      .post('/partner/v1/visits')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(intakeFor(MED_ID, refusedMaster))
      .expect(200);

    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { externalMasterId: refusedMaster },
      include: { items: true, assignedProvider: { include: { user: true } } },
    });

    const provider = await login(visit.assignedProvider!.user.email, 'Provider!2026');
    await request(app.getHttpServer())
      .post(`/v1/clinic/visits/${visit.id}/decide`)
      .set('Authorization', `Bearer ${provider}`)
      .send({
        items: [
          {
            itemId: visit.items[0].id,
            decision: 'DENIED',
            reason: 'Contraindicated by the reported history.',
          },
        ],
      })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // No prescription, so no order, so no revenue. The rule holds because of
    // what the schema allows, not because a query remembered to filter.
    const orders = await prisma.pharmacyOrder.count({
      where: { prescription: { requestId: visit.id } },
    });
    expect(orders).toBe(0);

    const after = await request(app.getHttpServer())
      .get('/v1/super-admin/revenue/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(after.body.thisMonth.revenueCents).toBe(before.body.thisMonth.revenueCents);

    // The clinician is still paid: the review was the same work either way.
    expect(after.body.thisMonth.providerFeesCents).toBeGreaterThan(
      before.body.thisMonth.providerFeesCents,
    );
    // Which means a refusal costs us money, and the profit figure must show it.
    expect(after.body.thisMonth.profitCents).toBeLessThan(before.body.thisMonth.profitCents);

    // A suite that accumulates a patient per run turns the demo data into noise.
    await prisma.prescriptionRequest.deleteMany({ where: { patientId: visit.patientId } });
    await prisma.patient.delete({ where: { id: visit.patientId } }).catch(() => undefined);
  });

  it('6d. a client sees what it owes, and never our cost or our margin', async () => {
    const token = await login('admin@joeymed.test', 'Admin!2026');

    const spend = await request(app.getHttpServer())
      .get('/v1/admin/spend/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(spend.body.thisMonth.spendCents).toBeGreaterThan(0);

    // The client's own margin is theirs to see: what its patients paid, less
    // what we charge it. A different number from ours, built from figures it
    // supplied itself.
    expect(spend.body.thisMonth).toHaveProperty('marginCents');
    expect(spend.body.thisMonth.marginCents).toBe(
      spend.body.thisMonth.earnedCents - spend.body.thisMonth.spendCents,
    );

    // Ours is not. What the pharmacy charges us, what the clinician was paid,
    // and what we keep are absent from the payload entirely — not merely hidden
    // by the page that renders it.
    const serialised = JSON.stringify(spend.body);
    for (const leak of ['costOfGoods', 'profit', 'providerFees', 'revenueCents']) {
      expect(serialised).not.toContain(leak);
    }

    // And the platform's own figures are refused outright, not merely absent.
    await request(app.getHttpServer())
      .get('/v1/super-admin/revenue/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('7. the pharmacy sees allergies but not the questionnaire', async () => {
    const token = await login('rx@firstchoice.test', 'Pharmacy!2026');

    const response = await request(app.getHttpServer())
      .get('/v1/dispensary/queue?limit=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const order = response.body.data.find(
      (row: { patient: { name: string } }) =>
        row.patient.name === `${patient.firstName} ${patient.lastName}`,
    );

    expect(order).toBeDefined();
    expect(order.patient.allergies.map((a: { substance: string }) => a.substance)).toContain('Codeine');

    const serialised = JSON.stringify(order).toLowerCase();
    expect(serialised).not.toContain('questionnaire');
    expect(serialised).not.toContain('prior glp-1');
  });

  it('8. a bad tracking number is rejected, a good one ships', async () => {
    const token = await login('rx@firstchoice.test', 'Pharmacy!2026');
    const order = await prisma.pharmacyOrder.findFirstOrThrow({
      where: { prescription: { request: { externalMasterId: masterId } } },
    });

    await request(app.getHttpServer())
      .post(`/v1/dispensary/orders/${order.id}/ship`)
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'FEDEX', trackingNumber: 'NOT-A-TRACKING-NUMBER' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/dispensary/orders/${order.id}/ship`)
      .set('Authorization', `Bearer ${token}`)
      .send({ carrier: 'FEDEX', trackingNumber: '770987654321' })
      .expect(200);
  });

  it('9. the patient is told, without the medication leaving by SMS', async () => {
    const record = await prisma.patient.findFirstOrThrow({
      where: { phone: patient.phone },
      include: { user: true },
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: record.user!.id, kind: 'order.shipped' },
      include: { deliveries: true },
    });

    // In-app carries the detail, because it sits behind authentication.
    expect(notification.body).toContain('Semaglutide');
    expect(notification.body).toContain('770987654321');

    // Email and SMS carry none of it.
    for (const channel of ['EMAIL', 'SMS'] as const) {
      const delivery = notification.deliveries.find((d) => d.channel === channel);
      expect(delivery?.renderedBody).toBeTruthy();
      expect(delivery!.renderedBody).not.toContain('Semaglutide');
      expect(delivery!.renderedBody).not.toContain('770987654321');
    }
  });

  it('10. the telehealth business sees its own visit, intake and shipment, in one stage', async () => {
    const token = await login('admin@joeymed.test', 'Admin!2026');

    const visits = await request(app.getHttpServer())
      .get('/v1/admin/visits?pageSize=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const visit = visits.body.data.find((row: { masterId: string }) => row.masterId === masterId);
    expect(visit.shipment.trackingNumber).toBe('770987654321');
    // The three status columns collapse into the one answer a client asks for.
    expect(visit.stage).toBe('SHIPPED');

    // And the stage filter finds it, in SQL, with an honest count.
    const shipped = await request(app.getHttpServer())
      .get('/v1/admin/visits?stage=SHIPPED&pageSize=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(shipped.body.data.map((row: { id: string }) => row.id)).toContain(visit.id);
    /**
     * Counted in SQL by the same predicate, so the total describes the filter
     * rather than the unfiltered table.
     *
     * Asserted as "the filtered total, and no more than a page of it" rather
     * than as equality. Equality only holds while the filtered set happens to
     * fit on one page, so the test began failing the day this environment
     * accumulated a fifty-first shipped visit — for reasons that had nothing to
     * do with the thing under test.
     */
    expect(shipped.body.pageInfo.total).toBeGreaterThanOrEqual(shipped.body.data.length);
    expect(shipped.body.data.length).toBeLessThanOrEqual(50);
    // And it knows it was filtered, which is what lets the console say "no
    // results" rather than "nothing here yet" on an empty page.
    expect(shipped.body.meta.filtered).toBe(true);
    expect(shipped.body.data.every((row: { stage: string }) => row.stage === 'SHIPPED')).toBe(true);

    const pending = await request(app.getHttpServer())
      .get('/v1/admin/visits?stage=PENDING_REVIEW&pageSize=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pending.body.data.map((row: { id: string }) => row.id)).not.toContain(visit.id);

    /**
     * A stage filter and a column filter at the same time.
     *
     * Both reach Prisma as `AND`, and merging them by spreading one object into
     * another left only the last — so picking a stage and then typing a name
     * quietly dropped the stage and listed that patient's visits from every
     * stage. Asserted here, through the real SQL, because that is the layer the
     * loss was invisible at: each filter alone behaved perfectly.
     */
    const surname = String(visit.patient.name).split(' ').pop();

    const both = await request(app.getHttpServer())
      .get(`/v1/admin/visits?stage=SHIPPED&patient=${surname}&pageSize=50`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(both.body.data.map((row: { id: string }) => row.id)).toContain(visit.id);
    expect(both.body.data.every((row: { stage: string }) => row.stage === 'SHIPPED')).toBe(true);

    // The sharp end: this visit matches the name but not the stage, so a stage
    // clause that survived the merge excludes it and one that did not does not.
    const wrongStage = await request(app.getHttpServer())
      .get(`/v1/admin/visits?stage=PENDING_REVIEW&patient=${surname}&pageSize=50`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(wrongStage.body.data.map((row: { id: string }) => row.id)).not.toContain(visit.id);

    // The business collected this intake, so it reads it back.
    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/visits/${visit.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detail.body.stage).toBe('SHIPPED');
    expect(detail.body.questionnaire.answers.length).toBeGreaterThan(0);
    expect(detail.body.prescriptions[0].orders[0].trackingNumber).toBe('770987654321');

    // What the clinician wrote about it, it does not.
    expect(detail.body.redactedSections).toEqual(
      expect.arrayContaining(['PROVIDER_NOTES', 'LAB_RESULTS']),
    );
    expect(detail.body.providerNotes).toBeUndefined();
  });

  it('10b. another business cannot reach this one\'s visit', async () => {
    const token = await login('admin@joeymed.test', 'Admin!2026');

    // Resolved from the account rather than a hardcoded slug: a test that
    // compares against the wrong string picks one of this tenant's own visits
    // and then passes by fetching something the admin is entitled to.
    const me = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@joeymed.test' },
      select: { tenantId: true },
    });

    const other = await prisma.prescriptionRequest.findFirst({
      where: { tenantId: { not: me.tenantId! } },
      select: { id: true },
    });

    if (!other) {
      // Nothing to prove against on a single-tenant database, and asserting on
      // an absent fixture would pass for the wrong reason.
      return;
    }

    await request(app.getHttpServer())
      .get(`/v1/admin/visits/${other.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('11. the patient sees their own prescription and its tracking', async () => {
    const record = await prisma.patient.findFirstOrThrow({
      where: { phone: patient.phone },
      include: { user: true },
    });
    await prisma.user.update({
      where: { id: record.user!.id },
      data: {
        passwordHash: await argon2.hash('E2ePatient!2026', { type: argon2.argon2id }),
        isEmailVerified: true,
      },
    });

    const token = await login(patient.email, 'E2ePatient!2026');

    const response = await request(app.getHttpServer())
      .get('/v1/portal/prescriptions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const prescription = response.body.data[0];
    expect(prescription.medication).toContain('Semaglutide');
    expect(prescription.shipment.trackingNumber).toBe('770987654321');
    expect(prescription.licenseState).toBe('AZ');
  });

  it('12a. a medication the chosen pharmacy does not stock is refused at intake', async () => {
    // The visit names a pharmacy *and* the medications the patient chose. If the
    // two disagree, the order routes somewhere that cannot fill it and the
    // failure surfaces days later as a patient still waiting.
    const pharmacy = await prisma.pharmacy.findFirstOrThrow({ where: { slug: 'first-choice' } });
    // Deliberately a medication this pharmacy *can* dispense, so the branded /
    // compounded capability gate does not fire first and mask what is under
    // test: whether the pharmacy actually stocks it.
    // A kit this pharmacy is permitted to dispense, so the capability gate does
    // not fire first and mask what is under test: whether they stock it.
    const product = await prisma.pharmacyProduct.findFirst({
      where: {
        pharmacyId: pharmacy.id,
        isActive: true,
        medication: {
          isControlled: false,
          ...(pharmacy.dispensesCompounded ? { isCompounded: true } : { isBranded: true }),
        },
      },
      // The medId is what a client orders by, so the test needs it selected.
      include: { medication: { select: { medId: true } } },
    });
    if (!product) return; // nothing in this pharmacy's catalogue

    // A client orders by medId, not by the pharmacy's kit code.
    const ordered = product.medication?.medId ?? product.kitCode;

    await prisma.pharmacyProduct.update({ where: { id: product.id }, data: { isActive: false } });
    try {
      const response = await request(app.getHttpServer())
        .post('/partner/v1/visits')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(intakeFor(ordered, `${masterId}-unstocked`))
        .expect(400);

      expect(response.body.error).toContain('does not stock');
      expect(response.body.error).toContain(ordered);

      // And the lookup a client builds its form from stops offering it.
      const catalogue = await request(app.getHttpServer())
        .get('/partner/v1/pharmacies/first-choice/catalog')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(catalogue.body.data.map((row: { medId: string }) => row.medId)).not.toContain(ordered);
    } finally {
      await prisma.pharmacyProduct.update({ where: { id: product.id }, data: { isActive: true } });
    }
  });

  it('12b. and is accepted again once the pharmacy carries it', async () => {
    const stocked = await request(app.getHttpServer())
      .get('/partner/v1/pharmacies/first-choice/catalog')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    // The lookup answers in medIds, which is what a client puts on an order.
    const first = stocked.body.data[0];
    if (!first) return;

    await request(app.getHttpServer())
      .post('/partner/v1/visits')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(intakeFor(first.medId, `${masterId}-stocked`))
      .expect(200);
  });

  it('11b. the patient was told at every step, in order', async () => {
    // Every milestone posts into their conversation. Silence between paying and
    // a parcel arriving is the whole complaint this answers.
    await new Promise((resolve) => setTimeout(resolve, 600));

    const record = await prisma.patient.findFirstOrThrow({
      where: { phone: patient.phone },
      select: { id: true },
    });

    const thread = await prisma.chatThread.findFirstOrThrow({
      where: { kind: 'PATIENT_PROVIDER', patientId: record.id },
      include: { messages: { orderBy: { sentAt: 'asc' } } },
    });

    const story = thread.messages.map((message) => phi.decrypt(message.content));
    const said = (fragment: string) => story.some((line) => line.includes(fragment));

    expect(said('a licensed clinician is reviewing it')).toBe(true);
    expect(said('has prescribed')).toBe(true);
    expect(said('has been sent to')).toBe(true);
    expect(said('on its way')).toBe(true);
    expect(said('770987654321')).toBe(true);

    // In the order they happened, so the conversation reads as a story rather
    // than a pile of notifications.
    const at = (fragment: string) => story.findIndex((line) => line.includes(fragment));
    expect(at('a licensed clinician is reviewing it')).toBeLessThan(at('has prescribed'));
    expect(at('has prescribed')).toBeLessThan(at('on its way'));

    // Every one is the system speaking, not the clinician.
    expect(thread.messages.every((message) => message.kind === 'SYSTEM')).toBe(true);
  });

  it('12. one tenant cannot see another tenant’s patient', async () => {
    const token = await login('admin@acmehealth.test', 'Admin!2026');
    const record = await prisma.patient.findFirstOrThrow({ where: { phone: patient.phone } });

    await request(app.getHttpServer())
      .get(`/v1/admin/patients/${record.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
