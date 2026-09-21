import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '@/app.module';
import { EmailAdapter } from '@/contexts/notifications/channels/email.adapter';
import type { DeliveryResult, OutboundMessage } from '@/contexts/notifications/channels/channel.interface';

/**
 * How a pharmacy becomes a user of the platform.
 *
 * Everything between "a stranger fills in the public form" and "they sign in and
 * see their own queue" is Super Admin work with real consequences: an account
 * gets created, an email leaves the building, and a role is granted. This
 * exercises that path end to end, including the parts that must NOT happen —
 * approving before the paperwork is accepted, and reusing an invite link.
 */
class CapturingEmailAdapter extends EmailAdapter {
  readonly sent: OutboundMessage[] = [];
  protected override async transmit(message: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return { ok: true, externalId: `test-${this.sent.length}` };
  }
  lastTo(address: string): OutboundMessage | undefined {
    return [...this.sent].reverse().find((m) => m.target === address);
  }
}

describe('pharmacy onboarding to account (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let email: CapturingEmailAdapter;
  let applicationId: string;
  let pharmacyId: string | undefined;
  let superToken: string;
  let requiredDocuments: string[] = [];

  const contactEmail = `dana.${randomUUID().slice(0, 8)}@harborrx.test`;
  const password = 'HarborRx!2026x';

  const login = async (user: string, pass: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user, password: pass })
      .expect(200);
    return res.body.tokens.accessToken;
  };

  /** Returns the supertest request itself, so each test can assert its own status. */
  const decide = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/super-admin/onboarding/pharmacies/${applicationId}/decision`)
      .set('Authorization', `Bearer ${superToken}`)
      .send(body);

  beforeAll(async () => {
    email = new CapturingEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailAdapter)
      .useValue(email)
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = new PrismaClient();
    superToken = await login('super@healthemr.test', 'Super!2026');
  });

  afterAll(async () => {
    // A suite that leaves an approved pharmacy behind puts a fake dispensary in
    // the routing pool, which would quietly change other tests.
    const user = await prisma.user.findUnique({ where: { email: contactEmail } });
    if (user) {
      await prisma.userInvite.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    // Application before pharmacy: the application references it, and a delete
    // that fails here used to be swallowed, quietly leaving a fake dispensary in
    // the routing pool for every later run.
    await prisma.pharmacyApplicationDocument.deleteMany({ where: { applicationId } });
    await prisma.pharmacyApplication.deleteMany({ where: { id: applicationId } });
    if (pharmacyId) {
      await prisma.tenantPharmacy.deleteMany({ where: { pharmacyId } });
      await prisma.pharmacy.delete({ where: { id: pharmacyId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('1. anyone can apply, without an account', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/public/onboarding/pharmacy')
      .send({
        legalName: 'Harbor Point Pharmacy LLC',
        tradingName: 'Harbor Rx',
        contactName: 'Dana Ruiz',
        contactEmail,
        contactPhone: '5556661212',
        addressLine1: '9 Dock Rd',
        city: 'Miami',
        state: 'FL',
        postalCode: '33101',
        statesServed: ['FL'],
        dispensesCompounded: false,
        dispensesBranded: true,
        isOutsourcingFacility: false,
      })
      .expect(201);

    applicationId = res.body.applicationId;
    expect(applicationId).toBeTruthy();
    // The form is public, so it must not hand back anything but a receipt.
    expect(Object.keys(res.body).sort()).toEqual(['applicationId', 'requiredDocuments', 'submittedAt'].sort());
    requiredDocuments = res.body.requiredDocuments;
    expect(requiredDocuments).toContain('STATE_PHARMACY_LICENSE');
  });

  it('2. asking for more information emails the applicant what is missing', async () => {
    const notes = 'We need your Florida board of pharmacy licence and a certificate of liability insurance.';
    const res = await decide({ decision: 'INFO_REQUESTED', notes }).expect(200);
    expect(res.body.status).toBe('INFO_REQUESTED');

    const mail = email.lastTo(contactEmail);
    expect(mail?.subject).toContain('more for your HealthEMR application');
    expect(mail?.body).toContain(notes);
    // No account exists yet — an applicant is not a user.
    await expect(prisma.user.findUnique({ where: { email: contactEmail } })).resolves.toBeNull();
  });

  it('3. a decision that gives no reason is refused', async () => {
    await decide({ decision: 'REJECTED' }).expect(400);
  });

  it('4. approval is blocked while required documents are unaccepted', async () => {
    const res = await decide({ decision: 'APPROVED' }).expect(400);
    expect(res.body.message).toContain('not yet accepted');
    expect(res.body.message).toContain('STATE_PHARMACY_LICENSE');
  });

  it('5. approving creates the pharmacy and a locked PHARMACY account', async () => {
    for (const kind of requiredDocuments) {
      await prisma.pharmacyApplicationDocument.create({
        data: {
          applicationId,
          kind: kind as never,
          bucket: 'onboarding-documents',
          objectKey: `e2e/${kind}.pdf`,
          fileName: `${kind.toLowerCase()}.pdf`,
          mime: 'application/pdf',
          size: 1024,
          reviewStatus: 'ACCEPTED',
        },
      });
    }

    const res = await decide({ decision: 'APPROVED', notes: 'Licence verified.' }).expect(200);
    expect(res.body.status).toBe('APPROVED');
    pharmacyId = res.body.pharmacyId;
    expect(pharmacyId).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: contactEmail } });
    expect(user.role).toBe('PHARMACY');
    // Nobody — not even the Super Admin — sets a password on someone's behalf.
    expect(user.isActive).toBe(false);
    const invites = await prisma.userInvite.count({
      where: { userId: user.id, acceptedAt: null, revokedAt: null },
    });
    expect(invites).toBe(1);
  });

  it('6. the approval email carries a single-use link, not a password', async () => {
    const mail = email.lastTo(contactEmail);
    expect(mail?.subject).toContain('pharmacy account is ready');
    expect(mail?.body).toMatch(/\/accept-invite\?token=[A-Za-z0-9_-]{20,}/);
    expect(mail?.body).not.toContain(password);
  });

  it('7. the link sets a password once, and only once', async () => {
    const token = email.lastTo(contactEmail)!.body.match(/token=([A-Za-z0-9_-]+)/)![1];

    const accepted = await request(app.getHttpServer())
      .post('/v1/auth/accept-invite')
      .send({ token, password, confirmPassword: password })
      .expect(200);
    expect(accepted.body).toMatchObject({ email: contactEmail, role: 'PHARMACY' });

    // 404, not 400: one answer for expired, revoked and already-used, so a
    // stolen link cannot be probed to learn which it is.
    await request(app.getHttpServer())
      .post('/v1/auth/accept-invite')
      .send({ token, password, confirmPassword: password })
      .expect(404);
  });

  it('8. they can now sign in, and reach their queue but nothing above it', async () => {
    const token = await login(contactEmail, password);

    await request(app.getHttpServer())
      .get('/v1/dispensary/queue')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/super-admin/patients')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('9. the approval is in the audit log', async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { entityType: 'PharmacyApplication', entityId: applicationId, action: 'APPLICATION_DECIDED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry!.actorUserId).toBeTruthy();
  });
});
