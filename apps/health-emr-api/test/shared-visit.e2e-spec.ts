import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '@/app.module';

/**
 * A visit carrying two medications from two clinical categories, at a moment
 * when no single clinician is credentialed for both.
 *
 * This is the case the business actually asked about: a patient orders a
 * weight-loss injection and an ED tablet on one order, one clinician reviews
 * weight loss and another reviews ED. The visit stays one visit — one masterId,
 * one chart, one conversation with the patient — while each medication is
 * decided by somebody qualified to decide it, and each reviewer is paid for the
 * work they did.
 *
 * The suite narrows the roster to force the split. With a generalist on shift
 * the platform keeps the visit whole, which is the preferred outcome and is
 * covered in the routing unit tests; here we are testing the fallback.
 */
describe('a visit shared between two clinicians (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let apiKey: string;
  let masterId: string;

  /** First Choice's own catalogue. Intake resolves by medId, so these are real. */
  const MED_WEIGHT_LOSS = 'EfGOipA7A3DmEiBnw5Hao1g1O5tZaVuP';
  const MED_ED = 'xPG2dL44duNYhFDPkYlXKeSdIbplFRHf';

  // Two seed clinicians, each narrowed to one of the two categories for the
  // duration of this suite.
  const WEIGHT_LOSS_CLINICIAN = 'dr.reyes@healthemr.test';
  const ED_CLINICIAN = 'dr.okafor@healthemr.test';
  /** Anyone else who could take a line and make the assertions ambiguous. */
  const STOOD_DOWN = ['dr.lindqvist@healthemr.test', 'elena.vasquez@clinic.test'];

  let restoreCategories: Array<{ providerId: string; categoryId: string }> = [];
  let pausedProviderIds: string[] = [];
  let restoreStates: string[] = [];
  let tenantId = '';
  let visitId = '';

  const profileFor = async (email: string) =>
    prisma.providerProfile.findFirstOrThrow({
      where: { user: { email } },
      select: { id: true },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    prisma = new PrismaClient();

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'joeyMed' } });
    tenantId = tenant.id;

    const prefix = randomBytes(9).toString('base64url').slice(0, 12);
    apiKey = `hemr_${prefix}${randomBytes(32).toString('base64url')}`;
    await prisma.tenantApiKey.create({
      data: {
        tenantId,
        name: `e2e-shared-${randomUUID().slice(0, 8)}`,
        keyPrefix: prefix,
        keyHash: await argon2.hash(apiKey, { type: argon2.argon2id }),
        scopes: ['visit:create'],
      },
    });

    restoreStates = tenant.allowedStates;
    if (restoreStates.length && !restoreStates.includes('TX')) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { allowedStates: [...restoreStates, 'TX'] },
      });
    }

    // ── narrow the roster ────────────────────────────────────────────────
    // Both clinicians normally cover everything, which is the happy path the
    // routing unit tests already pin. Strip one category from each so that
    // neither covers the whole visit and the fallback is exercised.
    const narrow = async (email: string, slugs: string[]) => {
      const profile = await profileFor(email);
      const categories = await prisma.category.findMany({
        where: { slug: { in: slugs } },
        select: { id: true },
      });
      const ids = categories.map((row) => row.id);

      restoreCategories.push(
        ...(await prisma.providerCategory.findMany({
          where: { providerId: profile.id, categoryId: { in: ids } },
          select: { providerId: true, categoryId: true },
        })),
      );
      await prisma.providerCategory.deleteMany({
        where: { providerId: profile.id, categoryId: { in: ids } },
      });
    };

    await narrow(WEIGHT_LOSS_CLINICIAN, ['ED', 'EDfollowup']);
    await narrow(ED_CLINICIAN, ['weightloss', 'weightlossfollowup']);

    // Everyone else steps off shift rather than losing credentials: pausing is
    // reversible without touching what anybody is qualified to do.
    const others = await prisma.providerProfile.findMany({
      where: { user: { email: { in: STOOD_DOWN } }, isAcceptingRequests: true },
      select: { id: true },
    });
    pausedProviderIds = others.map((row) => row.id);
    await prisma.providerProfile.updateMany({
      where: { id: { in: pausedProviderIds } },
      data: { isAcceptingRequests: false },
    });

    masterId = `E2E-SHARED-${randomUUID().slice(0, 8)}`;
  });

  afterAll(async () => {
    // Async dispatch from the last decision is still in flight; let it land
    // before the rows it writes against disappear.
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (restoreCategories.length) {
      await prisma.providerCategory.createMany({ data: restoreCategories, skipDuplicates: true });
    }
    if (pausedProviderIds.length) {
      await prisma.providerProfile.updateMany({
        where: { id: { in: pausedProviderIds } },
        data: { isAcceptingRequests: true },
      });
    }
    if (restoreStates.length) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { allowedStates: restoreStates } });
    }

    if (visitId) {
      const visit = await prisma.prescriptionRequest.findUnique({
        where: { id: visitId },
        select: { patientId: true },
      });
      await prisma.providerEarning.deleteMany({ where: { requestId: visitId } });
      await prisma.prescriptionRequest.delete({ where: { id: visitId } }).catch(() => undefined);
      if (visit) {
        const patient = await prisma.patient.findUnique({
          where: { id: visit.patientId },
          select: { userId: true, prescriptions: { select: { id: true }, take: 1 } },
        });
        if (patient && !patient.prescriptions.length) {
          await prisma.patient.delete({ where: { id: visit.patientId } }).catch(() => undefined);
          if (patient.userId) {
            await prisma.user.delete({ where: { id: patient.userId } }).catch(() => undefined);
          }
        }
      }
    }

    await prisma.tenantApiKey.deleteMany({ where: { name: { startsWith: 'e2e-shared-' } } });
    await prisma.$disconnect();
    await app.close();
  });

  const login = async (email: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'Provider!2026' })
      .expect(200);
    return response.body.tokens.accessToken;
  };

  const lineFor = <T extends { nameText: string }>(items: T[], needle: string): T =>
    items.find((item) => item.nameText.toLowerCase().includes(needle))!;

  const approval = (itemId: string, sig: string) => ({
    itemId,
    decision: 'APPROVED' as const,
    dose: '1 tablet',
    route: 'ORAL',
    frequency: 'as needed',
    sig,
  });

  it('accepts one visit carrying two categories, and shares it out', async () => {
    const response = await request(app.getHttpServer())
      .post('/partner/v1/visit/createNoPayPhotos')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        masterId,
        company: 'joeyMed',
        // The visit type stays singular — it is what questionnaire the patient
        // answered. Who reviews what is derived from the medications, not from
        // this field.
        visitType: 'weightloss',
        pharmacyId: 'first-choice',
        formObj: {
          consentsSigned: true,
          firstName: 'Amer',
          lastName: 'Haddad',
          dob: '07/04/1988',
          phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`,
          email: `amer.${randomUUID().slice(0, 8)}@example.test`,
          // Both clinicians in this suite hold an active Texas licence, which
          // is what makes either of them eligible to take a line at all.
          address: '88 Guadalupe St',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          sex: 'Male',
          selfReportedMeds: 'None',
          allergies: 'None',
          medicalConditions: 'None',
          patientPreference: [
            {
              name: 'Semaglutide 2.5mg/mL - 2mL',
              strength: '2.5 MG/ML',
              quantity: '1',
              refills: '0',
              daysSupply: '30',
              medId: MED_WEIGHT_LOSS,
            },
            {
              name: 'Sildenafil Citrate Oral Tablet',
              strength: '100 MG',
              quantity: '10',
              refills: '0',
              daysSupply: '30',
              medId: MED_ED,
            },
          ],
        },
      })
      // Reports the body on failure: an intake refusal names the rule it broke,
      // and "expected 200, got 400" alone sends you hunting for it.
      .expect(({ status, body }) => {
        if (status !== 200) throw new Error(`${status}: ${JSON.stringify(body)}`);
      });

    expect(response.body.data.masterId).toBe(masterId);

    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { tenantId, externalMasterId: masterId },
      include: { items: { include: { assignedProvider: { include: { user: true } } } } },
    });
    visitId = visit.id;

    const weightLoss = lineFor(visit.items, 'semaglutide');
    const ed = lineFor(visit.items, 'sildenafil');

    expect(weightLoss.assignedProvider!.user.email).toBe(WEIGHT_LOSS_CLINICIAN);
    expect(ed.assignedProvider!.user.email).toBe(ED_CLINICIAN);

    // One visit, not two. The patient has one thread and one masterId.
    expect(visit.status).toBe('ASSIGNED');
    expect(visit.externalMasterId).toBe(masterId);
  });

  it('puts the visit on both clinicians’ queues, marking whose line is whose', async () => {
    for (const [email, mine] of [
      [WEIGHT_LOSS_CLINICIAN, 'semaglutide'],
      [ED_CLINICIAN, 'sildenafil'],
    ] as const) {
      const token = await login(email);
      const response = await request(app.getHttpServer())
        .get('/v1/clinic/queue?limit=50')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const row = response.body.data.find((item: { visitId: string }) => item.visitId === visitId) as {
        shared: boolean;
        items: Array<{ nameText: string; mine: boolean }>;
      };
      expect(row).toBeDefined();
      expect(row.shared).toBe(true);
      expect(lineFor(row.items, mine).mine).toBe(true);
      expect(row.items.filter((item: { mine: boolean }) => item.mine)).toHaveLength(1);
    }
  });

  it('refuses a clinician who reaches for the other one’s medication', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { id: visitId },
      include: { items: true },
    });
    const token = await login(WEIGHT_LOSS_CLINICIAN);

    await request(app.getHttpServer())
      .post(`/v1/clinic/visits/${visitId}/decide`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [approval(lineFor(visit.items, 'sildenafil').id, 'Take one as needed.')] })
      .expect(403);
  });

  it('holds the visit open until the second clinician has decided', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { id: visitId },
      include: { items: true },
    });
    const token = await login(WEIGHT_LOSS_CLINICIAN);

    const response = await request(app.getHttpServer())
      .post(`/v1/clinic/visits/${visitId}/decide`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            itemId: lineFor(visit.items, 'semaglutide').id,
            decision: 'APPROVED',
            dose: '0.25mg',
            route: 'SUBCUTANEOUS',
            site: 'abdomen',
            frequency: 'once weekly',
            sig: 'Inject 0.25mg subcutaneously into the abdomen once weekly.',
          },
        ],
      })
      .expect(200);

    expect(response.body.awaitingOtherClinician).toBe(true);
    expect(response.body.status).toBe('IN_REVIEW');

    // The client is not told the visit is approved while a medication on it is
    // still under review.
    const after = await prisma.prescriptionRequest.findUniqueOrThrow({ where: { id: visitId } });
    expect(after.status).toBe('IN_REVIEW');
    expect(after.decidedAt).toBeNull();
  });

  it('drops the decided line off the first clinician’s queue, keeps the other’s', async () => {
    const decided = await login(WEIGHT_LOSS_CLINICIAN);
    const open = await request(app.getHttpServer())
      .get('/v1/clinic/queue?limit=50')
      .set('Authorization', `Bearer ${decided}`)
      .expect(200);
    expect(open.body.data.some((row: { visitId: string }) => row.visitId === visitId)).toBe(false);

    const waiting = await login(ED_CLINICIAN);
    const still = await request(app.getHttpServer())
      .get('/v1/clinic/queue?limit=50')
      .set('Authorization', `Bearer ${waiting}`)
      .expect(200);
    expect(still.body.data.some((row: { visitId: string }) => row.visitId === visitId)).toBe(true);
  });

  it('resolves the visit once, when the last line is decided', async () => {
    const visit = await prisma.prescriptionRequest.findFirstOrThrow({
      where: { id: visitId },
      include: { items: true },
    });
    const token = await login(ED_CLINICIAN);

    const response = await request(app.getHttpServer())
      .post(`/v1/clinic/visits/${visitId}/decide`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [approval(lineFor(visit.items, 'sildenafil').id, 'Take one tablet as needed before activity.')],
      })
      .expect(200);

    expect(response.body.awaitingOtherClinician).toBe(false);
    expect(response.body.status).toBe('APPROVED');

    const after = await prisma.prescriptionRequest.findUniqueOrThrow({ where: { id: visitId } });
    expect(after.status).toBe('APPROVED');
    expect(after.decidedAt).not.toBeNull();
  });

  it('signs each medication under the clinician who approved it', async () => {
    const prescriptions = await prisma.prescription.findMany({
      where: { requestId: visitId },
      include: {
        requestItem: { select: { nameText: true } },
        provider: { include: { user: { select: { email: true } } } },
      },
    });

    expect(prescriptions).toHaveLength(2);
    const byMedication = new Map(
      prescriptions.map((row) => [row.requestItem!.nameText.toLowerCase().slice(0, 4), row.provider.user.email]),
    );
    expect(byMedication.get('sema')).toBe(WEIGHT_LOSS_CLINICIAN);
    expect(byMedication.get('sild')).toBe(ED_CLINICIAN);
  });

  it('pays both clinicians — two reviews is two pieces of clinical work', async () => {
    const earnings = await prisma.providerEarning.findMany({
      where: { requestId: visitId },
      include: { provider: { include: { user: { select: { email: true } } } } },
    });

    expect(earnings).toHaveLength(2);
    expect(earnings.map((row) => row.provider.user.email).sort()).toEqual(
      [ED_CLINICIAN, WEIGHT_LOSS_CLINICIAN].sort(),
    );
    expect(earnings.every((row) => row.amountCents > 0)).toBe(true);
  });
});
