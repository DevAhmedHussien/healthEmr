import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '@/app.module';
import { TenantApiKeyService } from '@/contexts/tenancy/tenant-api-key.service';

/**
 * The external contract, status by status.
 *
 * This surface answers HTTP 200 with a status string in the body, so a client's
 * error handling is a switch over those strings and nothing else. Every one of
 * them is exercised here, including the three that are hard to reach by hand: a
 * referral, a prescription older than the resend window, and the retry cap.
 *
 * The guards are the point. Without them a resend is a way to obtain a
 * prescription for something no clinician assessed.
 */
describe('external visit surface (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let key: string;
  let tenantId: string;
  let patientId: string;
  let categoryId: string;
  let providerId: string;
  let pharmacyId: string;
  let medEd: { id: string; medId: string };
  let medWeightLoss: { id: string; medId: string };

  const created: string[] = [];
  const auth = () => ({ Authorization: `Bearer ${key}` });

  const preference = (medId: string) => ({
    name: 'Sildenafil Citrate Oral Tablet',
    strength: '100 MG',
    refills: '0',
    quantity: '10',
    daysSupply: '30',
    medId,
  });

  /** A visit built directly, so a test does not depend on who has queue capacity. */
  async function makeVisit(options: {
    decided?: boolean;
    signedDaysAgo?: number;
    referred?: boolean;
    retries?: number;
    shipped?: boolean;
  }): Promise<string> {
    const masterId = `e2e-ext-${randomUUID().slice(0, 8)}`;
    const submission = await prisma.qaSubmission.create({
      data: {
        tenantId,
        patientId,
        categoryId,
        templateVersion: 1,
        patientStateAtSubmission: 'TX',
        valuesJson: {},
      },
      select: { id: true },
    });

    const signedAt = new Date(Date.now() - (options.signedDaysAgo ?? 0) * 86_400_000);

    const visit = await prisma.prescriptionRequest.create({
      data: {
        tenantId,
        externalMasterId: masterId,
        qaSubmissionId: submission.id,
        patientId,
        categoryId,
        requestedPharmacyId: pharmacyId,
        status: options.decided ? 'APPROVED' : 'ASSIGNED',
        decidedAt: options.decided ? signedAt : null,
        referredAt: options.referred ? signedAt : null,
        referralReason: options.referred ? 'Needs an in-person cardiac review first.' : null,
        rxRetryCount: options.retries ?? 0,
      },
      select: { id: true },
    });
    created.push(visit.id);

    const item = await prisma.prescriptionRequestItem.create({
      data: {
        requestId: visit.id,
        medicationId: medEd.id,
        nameText: 'Sildenafil Citrate Oral Tablet',
        strength: '100 MG',
        quantity: '10',
        refills: '0',
        daysSupply: '30',
        decision: options.decided ? 'APPROVED' : 'PENDING',
      },
      select: { id: true },
    });

    if (options.decided) {
      const prescription = await prisma.prescription.create({
        data: {
          tenantId,
          requestId: visit.id,
          requestItemId: item.id,
          patientId,
          providerId,
          medicationId: medEd.id,
          dose: '100 MG',
          quantity: '10',
          refills: 0,
          sig: 'Take one tablet by mouth as needed.',
          signedAt,
          providerNameSnapshot: 'E2E Prescriber',
          licenseNumberSnapshot: 'E2E-000',
          licenseStateSnapshot: 'TX',
        },
        select: { id: true },
      });

      if (options.shipped) {
        await prisma.pharmacyOrder.create({
          data: { tenantId, prescriptionId: prescription.id, pharmacyId, status: 'SHIPPED' },
        });
      }
    }

    return masterId;
  }

  const send = (masterId: string, medId = medEd.medId, pharmacy = 'first-choice') =>
    request(app.getHttpServer())
      .post(`/partner/v1/visits/${masterId}/outcome`)
      .set(auth())
      .send({
        patientPreference: [preference(medId)],
        pharmacyId: pharmacy,
        masterId,
        apiKey: key,
      })
      .expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = new PrismaClient();

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'joeyMed' } });
    tenantId = tenant.id;

    ({ key } = await app
      .get(TenantApiKeyService)
      .issue(tenantId, `e2e-external-${randomUUID().slice(0, 6)}`));

    patientId = (
      await prisma.patient.findFirstOrThrow({
        where: { tenantLinks: { some: { tenantId } } },
        select: { id: true },
      })
    ).id;

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'ED' } })).id;
    providerId = (await prisma.providerProfile.findFirstOrThrow({ select: { id: true } })).id;
    pharmacyId = (
      await prisma.pharmacy.findFirstOrThrow({
        where: { slug: 'first-choice' },
        select: { id: true },
      })
    ).id;

    medEd = await prisma.medication.findFirstOrThrow({
      where: { medId: 'xPG2dL44duNYhFDPkYlXKeSdIbplFRHf' },
      select: { id: true, medId: true },
    });
    medWeightLoss = await prisma.medication.findFirstOrThrow({
      where: { medId: 'vywhPON4F9DCMuCdncQeGwwCwH0gfVxo' },
      select: { id: true, medId: true },
    });
  });

  afterAll(async () => {
    for (const id of created) {
      await prisma.prescriptionRequest.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('nothing may arrive empty', () => {
    it.each([
      ['an empty string', '', 'must not be empty'],
      ['null', null, 'must be a string'],
    ])('refuses %s, and names the field', async (_label, value, message) => {
      const response = await request(app.getHttpServer())
        .post('/partner/v1/visits/anything/outcome')
        .set(auth())
        .send({
          patientPreference: [{ ...preference(medEd.medId), name: value }],
          pharmacyId: 'first-choice',
          apiKey: key,
        })
        .expect(400);

      expect(response.body.details[0].path).toBe('patientPreference.0.name');
      expect(response.body.details[0].message).toContain(message);
    });

    it('refuses a missing field', async () => {
      const { name, ...withoutName } = preference(medEd.medId);
      expect(name).toBeDefined();

      const response = await request(app.getHttpServer())
        .post('/partner/v1/visits/anything/outcome')
        .set(auth())
        .send({
          patientPreference: [withoutName],
          pharmacyId: 'first-choice',
          apiKey: key,
        })
        .expect(400);

      expect(response.body.details[0].message).toBe('name is required');
    });

    it('refuses an empty preference array', async () => {
      await request(app.getHttpServer())
        .post('/partner/v1/visits/x/outcome')
        .set(auth())
        .send({ patientPreference: [], pharmacyId: 'first-choice', apiKey: key })
        .expect(400);
    });
  });

  describe('the guards, in the order the contract checks them', () => {
    it('NO_VISIT when the masterId is not ours', async () => {
      const { body } = await send('not-a-real-master-id');
      expect(body.status).toBe('NO_VISIT');
      expect(body.info).toBe('No visit found for masterId not-a-real-master-id');
    });

    it('VISIT_WAS_REFERRED beats everything else', async () => {
      // Referred and over the retry limit. The referral has to win: the answer
      // was never about the medication, so the retry count is beside the point.
      const masterId = await makeVisit({ decided: true, referred: true, retries: 99 });
      const { body } = await send(masterId);
      expect(body.status).toBe('VISIT_WAS_REFERRED');
      expect(body.info).toBe(`The visit ${masterId} was referred by a doctor`);
    });

    it('TOO_MANY_RETRIES once the account cap is reached', async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { rxRetryLimit: true },
      });
      const masterId = await makeVisit({ decided: true, retries: tenant.rxRetryLimit });

      const { body } = await send(masterId);
      expect(body.status).toBe('TOO_MANY_RETRIES');
      expect(body.info).toBe(`Rx retries limit reached for masterId ${masterId}`);
    });

    it('CATEGORY_MISMATCH for a medication outside the original category', async () => {
      const masterId = await makeVisit({ decided: true });
      const { body } = await send(masterId, medWeightLoss.medId);

      expect(body.status).toBe('CATEGORY_MISMATCH');
      expect(body.info).toContain(medWeightLoss.medId);
    });

    it('PHARMACY_MISMATCH for a pharmacy that is not ours to send to', async () => {
      const masterId = await makeVisit({ decided: true });
      const { body } = await send(masterId, medEd.medId, 'not-a-pharmacy');

      expect(body.status).toBe('PHARMACY_MISMATCH');
      expect(body.info).toContain('not-a-pharmacy');
    });

    it('TOO_LONG_AGO past the resend window', async () => {
      const masterId = await makeVisit({ decided: true, signedDaysAgo: 8 });
      const { body } = await send(masterId);

      expect(body.status).toBe('TOO_LONG_AGO');
      expect(body.info).toBe(`Rx was sent too long ago for masterId ${masterId}`);
    });

    it('still accepts a resend on the last day of the window', async () => {
      const masterId = await makeVisit({ decided: true, signedDaysAgo: 6 });
      const { body } = await send(masterId);

      expect(body.status).toBe('NEW_RX_SENT');
    });
  });

  describe('the two outcomes', () => {
    it('VISIT_DATA_UPDATED while nobody has decided, and replaces the lines', async () => {
      const masterId = await makeVisit({ decided: false });
      const { body } = await send(masterId);

      expect(body.status).toBe('VISIT_DATA_UPDATED');
      expect(body.info).toBe(`Visit data updated for ${masterId}`);

      const visit = await prisma.prescriptionRequest.findFirstOrThrow({
        where: { externalMasterId: masterId },
        include: { items: true },
      });
      // Replaced, not merged: the client sent the order it wants, not a patch.
      expect(visit.items).toHaveLength(1);
      expect(visit.rxRetryCount).toBe(0);
    });

    it('NEW_RX_SENT after an approval, attributed to the original prescriber', async () => {
      const masterId = await makeVisit({ decided: true });
      const { body } = await send(masterId);

      expect(body.status).toBe('NEW_RX_SENT');
      expect(body.info).toBe(`Successfully prescribed ${medEd.medId}`);
      expect(body.medsPrescribed).toHaveLength(1);
      expect(body.medsPrescribed[0]).toMatchObject({
        rxName: 'Sildenafil Citrate Oral Tablet',
        rxStrength: '100 MG',
        medId: medEd.medId,
      });
      expect(body.medsPrescribed[0].rxDirections).toBeTruthy();

      const visit = await prisma.prescriptionRequest.findFirstOrThrow({
        where: { externalMasterId: masterId },
        include: { prescriptions: { orderBy: { signedAt: 'desc' } } },
      });

      expect(visit.rxRetryCount).toBe(1);
      // The decision being re-issued is the clinician's, so the new
      // prescription carries their name and licence, not the client's.
      expect(visit.prescriptions[0].providerNameSnapshot).toBe('E2E Prescriber');
      // And the one it replaces must not stay live, or the chart shows two
      // prescriptions for one decision.
      expect(visit.prescriptions.filter((rx) => rx.status === 'SIGNED')).toHaveLength(1);
    });
  });

  describe('cancelling', () => {
    it('cancels a visit and stops anything a pharmacy could pick up', async () => {
      const masterId = await makeVisit({ decided: true });

      const { body } = await request(app.getHttpServer())
        .post(`/partner/v1/visits/${masterId}/cancel`)
        .set(auth())
        .send({ apiKey: key, reason: 'Patient cancelled with us before it shipped.' })
        .expect(200);

      expect(body.status).toBe('VISIT_CANCELLED');

      const visit = await prisma.prescriptionRequest.findFirstOrThrow({
        where: { externalMasterId: masterId },
        include: { prescriptions: true },
      });
      expect(visit.status).toBe('CANCELLED');
      expect(visit.prescriptions.every((rx) => rx.status === 'VOIDED')).toBe(true);
    });

    it('refuses once the medication has shipped', async () => {
      const masterId = await makeVisit({ decided: true, shipped: true });

      const { body } = await request(app.getHttpServer())
        .post(`/partner/v1/visits/${masterId}/cancel`)
        .set(auth())
        .send({ apiKey: key, reason: 'Patient changed their mind after dispatch.' })
        .expect(200);

      // The parcel is real and the record has to agree with it.
      expect(body.status).toBe('ALREADY_SHIPPED');
    });

    it('requires a reason', async () => {
      await request(app.getHttpServer())
        .post('/partner/v1/visits/x/cancel')
        .set(auth())
        .send({ apiKey: key, reason: '' })
        .expect(400);
    });
  });

  describe('the key in the body must name the account in the header', () => {
    it('refuses a payload key that is not the bearer token', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/partner/v1/visits/anything/outcome')
        .set(auth())
        .send({
          patientPreference: [preference(medEd.medId)],
          pharmacyId: 'first-choice',
          apiKey: 'hemr_a_completely_different_key',
        })
        .expect(200);

      expect(body.status).toBe('GENERIC');
      expect(body.info).toContain('apiKey does not match');
    });
  });

  describe('the lookups', () => {
    it('returns a visit in the documented shape, with nothing null', async () => {
      const masterId = await makeVisit({ decided: true });

      const { body } = await request(app.getHttpServer())
        .get(`/partner/v1/visits/${masterId}`)
        .set(auth())
        .expect(200);

      expect(body.status).toBe(200);
      expect(body.visitStatus).toBe('resolved');
      expect(body.resolvedStatus).toBe('closed');
      expect(body.resolvedTimestamp).toEqual(expect.any(String));

      const form = body.data.formObj;
      expect(Object.values(form).some((value) => value === null)).toBe(false);
      // MM/DD/YYYY, decrypted — it is stored encrypted and as text.
      expect(form.dob).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(['Male', 'Female', 'Other']).toContain(form.sex);
      // The platform medId the client orders by, never the pharmacy kit code.
      expect(form.patientPreference[0].medId).toBe(medEd.medId);
    });

    it('omits resolvedTimestamp while a visit is still open', async () => {
      const masterId = await makeVisit({ decided: false });

      const { body } = await request(app.getHttpServer())
        .get(`/partner/v1/visits/${masterId}`)
        .set(auth())
        .expect(200);

      expect(body.resolvedStatus).toBe('open');
      expect(body).not.toHaveProperty('resolvedTimestamp');
    });

    it('answers 200 with an error body for an unknown visit', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/partner/v1/visits/nope')
        .set(auth())
        .expect(200);

      expect(body).toEqual({ status: 400, error: 'Visit not found' });
    });

    it('finds a patient by phone, and lists their visits', async () => {
      const patient = await prisma.patient.findUniqueOrThrow({
        where: { id: patientId },
        select: { phone: true },
      });

      const { body } = await request(app.getHttpServer())
        .get(`/partner/v1/patients/by-phone/${patient.phone}`)
        .set(auth())
        .expect(200);

      expect(body.status).toBe(200);
      expect(body.data.phone).toBe(patient.phone);
      expect(Object.values(body.data).some((value) => value === null)).toBe(false);
      expect(Array.isArray(body.data.visits)).toBe(true);
    });

    it('refuses a phone number that is not ten digits', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/partner/v1/patients/by-phone/512555')
        .set(auth())
        .expect(200);

      expect(body.status).toBe(400);
    });

    it('is not reachable without a key', async () => {
      await request(app.getHttpServer())
        .get('/partner/v1/patients/by-phone/5125550142')
        .expect(401);
    });
  });
});
