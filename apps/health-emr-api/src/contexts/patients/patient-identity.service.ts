import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Sex } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';

export interface PatientIdentityInput {
  firstName: string;
  lastName: string;
  /** MM/DD/YYYY as supplied by the partner. */
  dob: string;
  sexAtBirth: Sex;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  residenceState: string;
  postalCode: string;
}

/**
 * Resolves a submission to a person.
 *
 * One human may buy from several client businesses, and they must not end up
 * with two charts — a provider prescribing without seeing what the patient is
 * already taking is the failure this prevents. So `Patient` is platform-level
 * and deduplicated on phone plus date of birth, while `TenantPatient` records
 * which businesses have met them. A tenant can only ever see the join, so
 * Tenant A never learns that this person also buys from Tenant B.
 */
@Injectable()
export class PatientIdentityService {
  private readonly logger = new Logger(PatientIdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
  ) {}

  async resolveOrCreate(
    tenantId: string,
    input: PatientIdentityInput,
    externalContactId?: string | null,
  ): Promise<{ patientId: string; created: boolean }> {
    const dobCipher = this.phi.encrypt(input.dob);

    const existing = await this.prisma.raw.patient.findUnique({
      where: { phone_dob: { phone: input.phone, dob: dobCipher } },
      select: { id: true },
    });

    // Deterministic ciphertext would be required for an equality lookup, but
    // AES-GCM is randomised — so when encryption is on we fall back to matching
    // on phone and comparing the decrypted dob in the application.
    const patient = existing ?? (await this.findByDecryptedDob(input.phone, input.dob));

    if (patient) {
      await this.linkTenant(tenantId, patient.id, externalContactId);
      return { patientId: patient.id, created: false };
    }

    const created = await this.prisma.raw.patient.create({
      data: {
        mrn: await this.nextMrn(),
        firstName: input.firstName,
        lastName: input.lastName,
        dob: dobCipher,
        sexAtBirth: input.sexAtBirth,
        phone: input.phone,
        email: input.email.toLowerCase(),
        addressLine1: input.addressLine1,
        city: input.city,
        residenceState: input.residenceState,
        postalCode: input.postalCode,
      },
      select: { id: true },
    });

    await this.linkTenant(tenantId, created.id, externalContactId);
    await this.provisionLoginAccount(created.id, input);
    return { patientId: created.id, created: true };
  }

  /**
   * Gives the patient a way to sign in.
   *
   * A chart without an account is a chart the patient cannot see, which defeats
   * the point of a patient portal. The account is created locked: the password
   * is random and discarded, `isEmailVerified` is false, and the patient claims
   * it through the set-password flow. Nobody — including us — knows a password
   * that works.
   *
   * If the address already belongs to a non-patient account (a clinic admin who
   * is also a customer, say) we do not link: quietly attaching a chart to an
   * admin login would be an escalation waiting to happen. It is logged for a
   * human to resolve.
   */
  private async provisionLoginAccount(
    patientId: string,
    input: PatientIdentityInput,
  ): Promise<void> {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.raw.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (existing) {
      if (existing.role !== 'PATIENT') {
        this.logger.warn(
          `Chart ${patientId} shares an email with a ${existing.role} account; no patient login created.`,
        );
        return;
      }

      // A returning patient buying through a second tenant already has a login.
      await this.prisma.raw.patient.update({
        where: { id: patientId },
        data: { userId: existing.id },
      });
      return;
    }

    const unusablePassword = await argon2.hash(randomBytes(32).toString('base64'), {
      type: argon2.argon2id,
    });

    const user = await this.prisma.raw.user.create({
      data: {
        email,
        passwordHash: unusablePassword,
        role: 'PATIENT',
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        isEmailVerified: false,
      },
      select: { id: true },
    });

    await this.prisma.raw.patient.update({
      where: { id: patientId },
      data: { userId: user.id },
    });
  }

  private async findByDecryptedDob(phone: string, dob: string) {
    if (!this.phi.enabled) return null;

    const candidates = await this.prisma.raw.patient.findMany({
      where: { phone },
      select: { id: true, dob: true },
    });

    for (const candidate of candidates) {
      try {
        if (this.phi.decrypt(candidate.dob) === dob) return { id: candidate.id };
      } catch {
        // A row we cannot decrypt is not a match; leave it for key rotation.
      }
    }
    return null;
  }

  private async linkTenant(
    tenantId: string,
    patientId: string,
    externalContactId?: string | null,
  ): Promise<void> {
    await this.prisma.raw.tenantPatient.upsert({
      where: { tenantId_patientId: { tenantId, patientId } },
      create: { tenantId, patientId, externalContactId: externalContactId ?? null },
      update: externalContactId ? { externalContactId } : {},
    });
  }

  /** Human-readable, sequential, non-guessable-by-increment enough for a chart id. */
  /**
   * The next medical record number.
   *
   * From a database sequence, not from `count(*) + 1`. Counting rows reuses a
   * number the moment any patient is removed, and two intakes arriving together
   * both read the same count and claim the same MRN — a unique-constraint
   * failure at best, and two people sharing a record number at worst. `nextval`
   * is atomic and never goes backwards.
   */
  private async nextMrn(): Promise<string> {
    const [{ value }] = await this.prisma.raw.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('patient_mrn_seq') AS value
    `;
    return `HE${String(value).padStart(8, '0')}`;
  }

  /**
   * A patient may not start a second visit within 24 hours — including one
   * opened by a different client business. Mirrors Beluga's
   * "Patient not eligible for new visit".
   */
  async hasRecentVisit(patientId: string, withinHours = 24): Promise<boolean> {
    const since = new Date(Date.now() - withinHours * 3600 * 1000);
    const recent = await this.prisma.raw.prescriptionRequest.findFirst({
      where: {
        patientId,
        createdAt: { gte: since },
        status: { notIn: ['DENIED', 'CANCELLED', 'EXPIRED'] },
      },
      select: { id: true },
    });
    return recent !== null;
  }
}
