import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';

/**
 * A date of birth as `MM/DD/YYYY`, the format this contract documents.
 *
 * Stored as text, and in more than one shape depending on how the visit that
 * created the patient spelled it. Rewritten from the calendar parts rather than
 * through `Date`: a birth date has no time zone, and running it through one
 * moves it a day for everybody west of UTC.
 */
function asSlashDate(value: string | null | undefined): string {
  if (!value) return '';

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const parts = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value.trim());
  if (parts) return `${parts[1]}/${parts[2]}/${parts[3]}`;

  return value;
}

/** Nothing in these payloads may be null: absent data is an empty string. */
const str = (value: string | null | undefined): string => value ?? '';

/**
 * The visit statuses the contract exposes.
 *
 * Deliberately coarser than ours. A client integrating against this does not
 * need to know the difference between a visit waiting to be assigned and one
 * sitting in a clinician's queue — both are "pending" from outside, and
 * exposing the internal set would freeze our own workflow into their contract.
 */
const VISIT_STATUS: Record<string, string> = {
  RECEIVED: 'pending',
  PENDING_ASSIGNMENT: 'pending',
  ASSIGNED: 'active',
  IN_REVIEW: 'active',
  INFO_REQUESTED: 'holding',
  APPROVED: 'resolved',
  DENIED: 'resolved',
  EXPIRED: 'canceled',
  CANCELLED: 'canceled',
};

const RESOLVED = new Set(['APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED']);

/**
 * The two read-only lookups a client polls.
 *
 * Both decrypt PHI and both are audited as reads, because that is what they
 * are: a client pulling a patient's own account of their health back out of
 * our system. The audit entry is the answer to "who saw this, and when".
 */
@Injectable()
export class ExternalFetchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One patient, by the phone number the client knows them as.
   *
   * Scoped to the calling account. Two clients can each have a patient on the
   * same number — the same person, buying from both — and neither may see the
   * other's record of them.
   */
  async patientByPhone(tenantId: string, phone: string) {
    const patient = await this.prisma.raw.patient.findFirst({
      where: { phone, tenantLinks: { some: { tenantId } } },
      include: {
        allergies: { select: { substance: true } },
        conditions: { select: { display: true } },
        medications: { select: { nameText: true } },
        requests: {
          where: { tenantId, voidedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { externalMasterId: true },
        },
      },
    });

    if (!patient) return null;

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'Patient',
      entityId: patient.id,
      patientId: patient.id,
      tenantId,
      after: { via: 'patient/externalFetch' },
    });

    return {
      firstName: patient.firstName,
      lastName: patient.lastName,
      // Encrypted at rest. Decrypted here because the contract publishes it.
      dob: asSlashDate(this.phi.decrypt(patient.dob)),
      phone: patient.phone,
      email: patient.email,
      address: patient.addressLine1,
      city: patient.city,
      state: patient.residenceState,
      zip: patient.postalCode,
      sex: patient.sexAtBirth === 'MALE' ? 'Male' : 'Female',
      selfReportedMeds: patient.medications.map((row) => row.nameText).join(', '),
      allergies: patient.allergies.map((row) => row.substance).join(', '),
      medicalConditions: patient.conditions.map((row) => row.display).join(', '),
      visits: patient.requests.map((row) => row.externalMasterId),
    };
  }

  /** One visit, in the shape the contract documents, by the client's own id. */
  async visitByMasterId(tenantId: string, masterId: string) {
    const visit = await this.prisma.raw.prescriptionRequest.findFirst({
      where: { tenantId, externalMasterId: masterId, voidedAt: null },
      include: {
        category: { select: { slug: true } },
        patient: {
          include: {
            allergies: { select: { substance: true } },
            conditions: { select: { display: true } },
            medications: { select: { nameText: true } },
          },
        },
        items: {
          include: {
            medication: {
              select: {
                medId: true,
                // Which clinical category each medication belongs to, which is
                // what decides who may review it.
                categories: { select: { category: { select: { slug: true } } } },
              },
            },
          },
        },
        submission: {
          include: {
            answers: { orderBy: { questionId: 'asc' } },
            labResults: { orderBy: { screeningDate: 'desc' } },
          },
        },
        prescriptions: {
          orderBy: { signedAt: 'desc' },
          include: {
            medication: { select: { medId: true, name: true } },
            requestItem: { select: { nameText: true, daysSupply: true, kitCode: true } },
            orders: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { pharmacy: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!visit) return null;

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'PrescriptionRequest',
      entityId: visit.id,
      patientId: visit.patientId,
      tenantId,
      after: { via: 'visit/externalFetch', masterId },
    });

    const patient = visit.patient;
    const resolved = RESOLVED.has(visit.status);

    return {
      masterId,
      visitStatus: VISIT_STATUS[visit.status] ?? 'pending',
      updateTimestamp: visit.updatedAt.toISOString(),
      resolvedStatus: resolved ? 'closed' : 'open',
      ...(resolved && visit.decidedAt ? { resolvedTimestamp: visit.decidedAt.toISOString() } : {}),
      labResults: visit.submission.labResults.map((lab) => ({
        screeningDate: lab.screeningDate.toISOString(),
        testName: lab.testName,
        testResult: lab.testResult,
        testResultUnits: str(lab.testResultUnits),
        refRange: str(lab.refRange),
        statusIndicator: lab.statusIndicator,
        reportDate: lab.reportDate ? lab.reportDate.toISOString() : '',
        deviceType: str(lab.sampleSource),
      })),
      data: {
        formObj: {
          consentsSigned: true,
          firstName: patient.firstName,
          lastName: patient.lastName,
          // Encrypted at rest. Decrypted here because the contract publishes it.
          dob: asSlashDate(this.phi.decrypt(patient.dob)),
          phone: patient.phone,
          email: patient.email,
          address: patient.addressLine1,
          city: patient.city,
          state: patient.residenceState,
          zip: patient.postalCode,
          sex: patient.sexAtBirth === 'MALE' ? 'Male' : 'Female',
          selfReportedMeds: patient.medications.map((row) => row.nameText).join(', '),
          allergies: patient.allergies.map((row) => row.substance).join(', '),
          medicalConditions: patient.conditions.map((row) => row.display).join(', '),
          patientPreference: visit.items.map((item) => ({
            name: item.nameText,
            strength: item.strength,
            quantity: item.quantity,
            refills: item.refills,
            // The platform medId the client orders by, not the pharmacy's kit
            // code. They are different strings, and echoing the kit code back
            // would hand an integrator an id their next request is refused for.
            medId: item.medication.medId,
            /**
             * The categories this medication may be reviewed under, derived
             * from our catalogue.
             *
             * Reported rather than accepted: a client sending its own category
             * alongside the medication could choose its reviewer, and a value
             * that disagrees with the catalogue has to lose. `visitType` above
             * stays singular because it names the questionnaire the patient
             * answered — one form, one follow-up path — while a visit can carry
             * medications from more than one of these.
             */
            categories: item.medication.categories.map((row) => row.category.slug),
            /** PENDING, APPROVED, MODIFIED or DENIED — per medication. */
            status: item.decision,
          })),
          // Decrypted here and nowhere else on this surface. These are the
          // patient's own words about their body, and the read above is why
          // this call is in the audit trail.
          intakeResults: visit.submission.answers.map((answer) => ({
            question: this.phi.decrypt(answer.questionText ?? ''),
            answer: this.phi.decrypt((answer.valueJson as { encrypted?: string })?.encrypted ?? ''),
          })),
        },
        visitType: visit.category.slug,
        rxHistory: visit.prescriptions.map((rx) => ({
          rxTimestamp: rx.signedAt.toISOString(),
          favoriteName: rx.requestItem?.nameText ?? rx.medication.name,
          name: rx.medication.name,
          medId: rx.medication.medId,
          refills: String(rx.refills),
          quantity: rx.quantity,
          strength: rx.dose,
          daysSupply: rx.daysSupply === null ? '' : String(rx.daysSupply),
          unit: str(rx.requestItem?.kitCode),
          pharmacyNotes: str(rx.patientNote),
          pharmacyName: rx.orders[0]?.pharmacy.name ?? '',
          rxId: rx.id,
        })),
      },
    };
  }
}
