import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import { ChartSection, redactChart, visibleSections } from './redaction.policy';

/**
 * A telehealth business's own account.
 *
 * The lists and the visit detail live in `AdminClinicalService`; what remains
 * here is the single patient record and the tenant guard every route leans on.
 *
 * Two constraints hold at once throughout. The Prisma tenant extension confines
 * every query to the caller's tenant, so another client's patients are outside
 * the query rather than filtered out of it. On top of that the redaction policy
 * decides which sections of a chart this role may read.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One patient, filtered through the redaction policy.
   *
   * Sections are stripped by the policy rather than by omitting them from the
   * query, which is what makes the rule auditable: the response says which
   * sections were withheld, so a UI can distinguish "not shown to you" from
   * "this patient has none".
   */
  async getPatient(tenantId: string, patientId: string) {
    const link = await this.prisma.raw.tenantPatient.findUnique({
      where: { tenantId_patientId: { tenantId, patientId } },
      select: { id: true },
    });
    if (!link) throw new NotFoundException('Patient not found');

    const patient = await this.prisma.raw.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true, mrn: true, firstName: true, lastName: true, dob: true, sexAtBirth: true,
        email: true, phone: true, addressLine1: true, addressLine2: true, city: true,
        residenceState: true, postalCode: true, idPhotoKey: true, idPhotoVerifiedAt: true,
        createdAt: true,
        allergies: { where: { status: 'ACTIVE' } },
        conditions: { where: { clinicalStatus: 'ACTIVE' } },
        medications: { where: { status: 'ACTIVE' } },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'Patient',
      entityId: patientId,
      patientId,
      tenantId,
      after: { role: Role.ADMIN, sections: visibleSections(Role.ADMIN).length },
    });

    const chart = {
      patientId: patient.id,
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: this.phi.decrypt(patient.dob),
      sexAtBirth: patient.sexAtBirth,
      email: patient.email,
      phone: patient.phone,
      address: {
        line1: patient.addressLine1,
        line2: patient.addressLine2,
        city: patient.city,
        state: patient.residenceState,
        postalCode: patient.postalCode,
      },
      idPhotoOnFile: Boolean(patient.idPhotoKey),
      idPhotoVerifiedAt: patient.idPhotoVerifiedAt,
      allergies: patient.allergies.map((row) => ({
        substance: row.substance,
        severity: row.severity,
        reaction: row.reactionText,
      })),
      conditions: patient.conditions.map((row) => row.display),
      medications: patient.medications.map((row) =>
        [row.nameText, row.dose].filter(Boolean).join(' '),
      ),
      // Declared so the policy can strip them, and not fetched: these are the
      // clinician's own record rather than this business's.
      providerNotes: undefined as unknown,
      labResults: undefined as unknown,
    };

    return redactChart(Role.ADMIN, chart, {
      providerNotes: ChartSection.PROVIDER_NOTES,
      labResults: ChartSection.LAB_RESULTS,
      allergies: ChartSection.ALLERGIES,
      conditions: ChartSection.CONDITIONS,
      medications: ChartSection.MEDICATION_HISTORY,
      idPhotoOnFile: ChartSection.ID_PHOTO,
    });
  }

  tenantIdOrThrow(tenantId: string | null): string {
    if (!tenantId) {
      throw new ForbiddenException('This admin account is not linked to a tenant');
    }
    return tenantId;
  }
}
