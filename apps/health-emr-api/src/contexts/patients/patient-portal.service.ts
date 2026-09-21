import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';

/**
 * Everything a patient may see about themselves — and nothing else.
 *
 * Every query starts from the signed-in user's own chart id, so there is no
 * path here that takes a patient id from the caller.
 */
@Injectable()
export class PatientPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
  ) {}

  private async chartFor(userId: string) {
    const patient = await this.prisma.raw.patient.findUnique({ where: { userId } });
    if (!patient) throw new ForbiddenException('No patient record for this account');
    return patient;
  }

  async record(userId: string) {
    const patient = await this.chartFor(userId);

    const [allergies, conditions, medications] = await Promise.all([
      this.prisma.raw.allergy.findMany({
        where: { patientId: patient.id, status: 'ACTIVE' },
        select: { substance: true, severity: true, reactionText: true },
      }),
      this.prisma.raw.condition.findMany({
        where: { patientId: patient.id, clinicalStatus: 'ACTIVE' },
        select: { display: true, onsetDate: true },
      }),
      this.prisma.raw.patientMedication.findMany({
        where: { patientId: patient.id, status: 'ACTIVE' },
        select: { nameText: true, dose: true, frequency: true },
      }),
    ]);

    return {
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: this.phi.decrypt(patient.dob),
      sexAtBirth: patient.sexAtBirth,
      email: patient.email,
      phone: patient.phone,
      address: {
        line1: patient.addressLine1,
        city: patient.city,
        state: patient.residenceState,
        postalCode: patient.postalCode,
      },
      allergies,
      conditions,
      medications,
    };
  }

  async visits(userId: string) {
    const patient = await this.chartFor(userId);

    const rows = await this.prisma.raw.prescriptionRequest.findMany({
      where: {
        // Withdrawn visits are gone for the patient too.
        voidedAt: null, patientId: patient.id },
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true } },
        items: {
          select: {
            nameText: true, strength: true, quantity: true,
            decision: true, decisionReason: true,
          },
        },
      },
    });

    // Deliberately absent: which provider is assigned, and the tenant. Neither
    // is the patient's business until a decision exists.
    return rows.map((row) => ({
      visitId: row.id,
      category: row.category.name,
      status: row.status,
      submittedAt: row.createdAt,
      decidedAt: row.decidedAt,
      items: row.items,
    }));
  }

  async prescriptions(userId: string) {
    const patient = await this.chartFor(userId);

    const rows = await this.prisma.raw.prescription.findMany({
      where: { patientId: patient.id },
      orderBy: { signedAt: 'desc' },
      include: {
        medication: { select: { name: true, strength: true, form: true } },
        orders: {
          select: { status: true, trackingNumber: true, carrier: true, shippedAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return rows.map((row) => ({
      prescriptionId: row.id,
      medication: row.medication.name,
      dose: row.dose,
      quantity: row.quantity,
      refills: row.refills,
      directions: row.sig,
      status: row.status,
      signedAt: row.signedAt,
      prescriber: row.providerNameSnapshot,
      licenseNumber: row.licenseNumberSnapshot,
      licenseState: row.licenseStateSnapshot,
      shipment: row.orders[0] ?? null,
    }));
  }
}
