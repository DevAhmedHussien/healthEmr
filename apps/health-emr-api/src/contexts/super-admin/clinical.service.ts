import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListQuery, VisitStage } from '@health-emr/types';
import { visitStage } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import {
  buildOrderBy,
  listResponse,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';
import { countsByKey } from '@/shared/http/relation-counts';
import { visitStageWhere } from '@/contexts/admin/visit-stage.filter';

export const PATIENT_SORT = ['createdAt', 'lastName', 'mrn', 'residenceState'] as const;
export const PRESCRIPTION_SORT = ['signedAt', 'status'] as const;
export const VISIT_SORT = ['createdAt', 'decidedAt', 'status'] as const;

/**
 * Which columns of the visits table may be filtered, and where each one lives.
 *
 * Keyed by the column id the console renders, so the filter box under a header
 * and the query it produces cannot drift apart. `stage` is not here: it is a
 * derived predicate over several fields rather than a column, and keeps its own
 * parameter.
 */
export const VISIT_FILTERS = {
  masterId: { path: 'externalMasterId', kind: 'text' },
  patient: { path: 'patient.lastName', kind: 'text' },
  email: { path: 'patient.email', kind: 'text' },
  phone: { path: 'patient.phone', kind: 'text' },
  tenant: { path: 'tenant.name', kind: 'text' },
  category: { path: 'category.slug', kind: 'exact' },
  requestStatus: {
    path: 'status',
    kind: 'exact',
    values: ['RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED'],
  },
  provider: { path: 'assignedProvider.user.lastName', kind: 'text' },
  patientState: { path: 'submission.patientStateAtSubmission', kind: 'exact' },
  reason: { path: 'denialReason', kind: 'text' },
  shipment: { path: 'prescriptions[].orders[].status', kind: 'exact', values: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT', 'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED'] },
  tracking: { path: 'prescriptions[].orders[].trackingNumber', kind: 'text' },
  charge: { path: 'items[].quotedPriceCents', kind: 'number' },
  createdAt: { path: 'createdAt', kind: 'date' },
  decidedAt: { path: 'decidedAt', kind: 'date' },
  updatedAt: { path: 'updatedAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

/** Filterable columns of the patients table, keyed by the column id. */
export const PATIENT_FILTERS = {
  mrn: { path: 'mrn', kind: 'text' },
  lastName: { path: 'lastName', kind: 'text' },
  email: { path: 'email', kind: 'text' },
  phone: { path: 'phone', kind: 'text' },
  residenceState: { path: 'residenceState', kind: 'exact' },
  sexAtBirth: { path: 'sexAtBirth', kind: 'exact', values: ['MALE', 'FEMALE'] },
  accounts: { path: 'tenantLinks[].tenant.name', kind: 'text' },
  visits: { path: 'requests', kind: 'presence' },
  prescriptions: { path: 'prescriptions', kind: 'presence' },
  allergies: { path: 'allergies', kind: 'presence' },
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

/** Filterable columns of the prescriptions table, keyed by the column id. */
export const PRESCRIPTION_FILTERS = {
  medication: { path: 'medication.name', kind: 'text' },
  patient: { path: 'patient.lastName', kind: 'text' },
  email: { path: 'patient.email', kind: 'text' },
  phone: { path: 'patient.phone', kind: 'text' },
  patientState: { path: 'patient.residenceState', kind: 'exact' },
  tenant: { path: 'tenant.name', kind: 'text' },
  prescriber: { path: 'providerNameSnapshot', kind: 'text' },
  licence: { path: 'licenseNumberSnapshot', kind: 'text' },
  masterId: { path: 'request.externalMasterId', kind: 'text' },
  shipment: { path: 'orders[].status', kind: 'exact', values: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT', 'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED'] },
  tracking: { path: 'orders[].trackingNumber', kind: 'text' },
  invoice: { path: 'invoices', kind: 'presence' },
  invoiceNumber: { path: 'invoices[].number', kind: 'text' },
  signedAt: { path: 'signedAt', kind: 'date' },
  createdAt: { path: 'createdAt', kind: 'date' },
  updatedAt: { path: 'updatedAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

/**
 * The platform owner's clinical views.
 *
 * Super Admin reads across every tenant, which is exactly why every read here is
 * recorded as break-the-glass. Being permitted to open any chart is not the same
 * as opening one unremarked — the audit trail is what makes that power
 * accountable rather than merely convenient.
 */
@Injectable()
export class ClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
  ) {}

  async listPatients(query: ListQuery & { state?: string; tenantId?: string }) {
    const where: Prisma.PatientWhereInput = {
      ...(query.state ? { residenceState: query.state } : {}),
      ...(query.tenantId ? { tenantLinks: { some: { tenantId: query.tenantId } } } : {}),
      ...(searchAcross(query.q, ['firstName', 'lastName', 'mrn', 'email', 'phone']) ?? {}),
      ...columnFilterWhere(query, PATIENT_FILTERS),
    };

    const sort = safeSort(query.sort, PATIENT_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.patient.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        select: {
          id: true, mrn: true, firstName: true, lastName: true, email: true, phone: true,
          residenceState: true, sexAtBirth: true, createdAt: true,
          tenantLinks: { select: { tenant: { select: { name: true } } } },
        },
      }),
      this.prisma.raw.patient.count({ where }),
    ]);

    // Counted for this page rather than with Prisma's `_count`, which joins and
    // groups over the whole relation — 379ms of a 408ms response at a million
    // visits. See `countsByKey`.
    const ids = rows.map((row) => row.id);
    const [visits, scripts, allergies] = await Promise.all([
      countsByKey('patientId', ids, (list) =>
        this.prisma.raw.prescriptionRequest.groupBy({
          by: ['patientId'],
          where: { patientId: { in: list } },
          _count: { _all: true },
        }),
      ),
      countsByKey('patientId', ids, (list) =>
        this.prisma.raw.prescription.groupBy({
          by: ['patientId'],
          where: { patientId: { in: list } },
          _count: { _all: true },
        }),
      ),
      countsByKey('patientId', ids, (list) =>
        this.prisma.raw.allergy.groupBy({
          by: ['patientId'],
          where: { patientId: { in: list }, status: 'ACTIVE' },
          _count: { _all: true },
        }),
      ),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      mrn: row.mrn,
      name: `${row.firstName} ${row.lastName}`,
      email: row.email,
      phone: row.phone,
      state: row.residenceState,
      sexAtBirth: row.sexAtBirth,
      // A person may belong to several client businesses; the platform sees all
      // of them, while each tenant only ever sees its own link.
      accounts: row.tenantLinks.map((link) => link.tenant.name),
      visits: visits.get(row.id) ?? 0,
      prescriptions: scripts.get(row.id) ?? 0,
      allergies: allergies.get(row.id) ?? 0,
      createdAt: row.createdAt,
    }));

    return listResponse(data, total, query, PATIENT_SORT);
  }

  /** One complete chart. Nothing is withheld from this role — and it is logged. */
  async getPatient(id: string, actorUserId: string) {
    const patient = await this.prisma.raw.patient.findUnique({
      where: { id },
      include: {
        user: { select: { email: true, isActive: true, lastLoginAt: true } },
        tenantLinks: { include: { tenant: { select: { id: true, name: true, slug: true } } } },
        allergies: { orderBy: { createdAt: 'desc' } },
        conditions: { orderBy: { createdAt: 'desc' } },
        medications: { orderBy: { createdAt: 'desc' } },
        vitals: { orderBy: { recordedAt: 'desc' }, take: 10 },
        labResults: { orderBy: { screeningDate: 'desc' }, take: 20 },
        documents: { orderBy: { createdAt: 'desc' } },
        requests: {
          orderBy: { createdAt: 'desc' },
          include: {
            category: { select: { slug: true, name: true } },
            tenant: { select: { name: true } },
            assignedProvider: { include: { user: { select: { firstName: true, lastName: true } } } },
            items: true,
          },
        },
        prescriptions: {
          orderBy: { signedAt: 'desc' },
          include: {
            medication: { select: { name: true, strength: true, form: true } },
            orders: {
              orderBy: { createdAt: 'desc' },
              include: { pharmacy: { select: { name: true } } },
            },
            // So the record can say whether a fill was ever billed, and the
            // console can offer to raise the invoice where it was not.
            invoices: { select: { id: true, number: true, status: true, totalCents: true } },
          },
        },
      },
    });

    if (!patient) throw new NotFoundException('Patient not found');

    await this.audit.record({
      action: 'BREAK_THE_GLASS',
      entityType: 'Patient',
      entityId: id,
      patientId: id,
      actorUserId,
      after: { reason: 'Super Admin opened a full patient record' },
    });

    return {
      id: patient.id,
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
      hasLogin: Boolean(patient.userId),
      loginActive: patient.user?.isActive ?? false,
      lastLoginAt: patient.user?.lastLoginAt ?? null,
      idPhotoOnFile: Boolean(patient.idPhotoKey),
      idPhotoVerifiedAt: patient.idPhotoVerifiedAt,
      createdAt: patient.createdAt,
      accounts: patient.tenantLinks.map((link) => link.tenant),
      allergies: patient.allergies,
      conditions: patient.conditions,
      medications: patient.medications,
      vitals: patient.vitals,
      labResults: patient.labResults,
      documents: patient.documents.map((doc) => ({
        id: doc.id, kind: doc.kind, fileName: doc.fileName, mime: doc.mime, size: doc.size,
      })),
      visits: patient.requests.map((request) => ({
        id: request.id,
        masterId: request.externalMasterId,
        status: request.status,
        category: request.category.name,
        categorySlug: request.category.slug,
        tenant: request.tenant.name,
        provider: request.assignedProvider
          ? `${request.assignedProvider.user.firstName} ${request.assignedProvider.user.lastName}`
          : null,
        submittedAt: request.createdAt,
        decidedAt: request.decidedAt,
        denialReason: request.denialReason,
        items: request.items.map((item) => ({
          // Two lines can carry the same medication name after a resend, so
          // the row needs an identity that is not its label.
          id: item.id,
          name: item.nameText,
          strength: item.strength,
          quantity: item.quantity,
          decision: item.decision,
          reason: item.decisionReason,
        })),
      })),
      prescriptions: patient.prescriptions.map((prescription) => ({
        id: prescription.id,
        medication: prescription.medication.name,
        dose: prescription.dose,
        quantity: prescription.quantity,
        refills: prescription.refills,
        directions: prescription.sig,
        status: prescription.status,
        signedAt: prescription.signedAt,
        prescriber: prescription.providerNameSnapshot,
        licence: `${prescription.licenseNumberSnapshot} (${prescription.licenseStateSnapshot})`,
        orders: prescription.orders.map((order) => ({
          id: order.id,
          pharmacy: order.pharmacy.name,
          status: order.status,
          carrier: order.carrier,
          trackingNumber: order.trackingNumber,
          shippedAt: order.shippedAt,
        })),
        invoice: prescription.invoices[0]
          ? {
              id: prescription.invoices[0].id,
              number: prescription.invoices[0].number,
              status: prescription.invoices[0].status,
              totalCents: prescription.invoices[0].totalCents,
            }
          : null,
      })),
      billing: billingSummary(patient.prescriptions.flatMap((prescription) => prescription.invoices)),
    };
  }

  /** Every prescription, across every tenant. */
  async listPrescriptions(
    query: ListQuery & { status?: string; tenantId?: string; providerId?: string },
  ) {
    const where: Prisma.PrescriptionWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(searchAcross(query.q, [
        'patient.mrn',
        'patient.lastName',
        'patient.email',
        'patient.phone',
        'medication.name',
      ]) ?? {}),
      ...columnFilterWhere(query, PRESCRIPTION_FILTERS),
      // A prescription on a withdrawn visit is withdrawn with it.
      request: { voidedAt: null },
    };

    const sort = safeSort(query.sort, PRESCRIPTION_SORT, 'signedAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.prescription.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        include: {
          medication: { select: { name: true, strength: true } },
          patient: {
            select: {
              id: true,
              mrn: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              residenceState: true,
            },
          },
          tenant: { select: { name: true } },
          provider: { include: { user: { select: { firstName: true, lastName: true } } } },
          request: { select: { id: true, externalMasterId: true, categoryId: true } },
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { pharmacy: { select: { name: true } } },
          },
          invoices: { select: { id: true, number: true, status: true, totalCents: true }, take: 1 },
        },
      }),
      this.prisma.raw.prescription.count({ where }),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      visitId: row.request.id,
      masterId: row.request.externalMasterId,
      medication: row.medication.name,
      dose: row.dose,
      quantity: row.quantity,
      refills: row.refills,
      status: row.status,
      signedAt: row.signedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      prescriber: row.providerNameSnapshot,
      licence: `${row.licenseNumberSnapshot} (${row.licenseStateSnapshot})`,
      patient: {
        id: row.patient.id,
        mrn: row.patient.mrn,
        name: `${row.patient.firstName} ${row.patient.lastName}`,
        email: row.patient.email,
        phone: row.patient.phone,
        state: row.patient.residenceState,
      },
      tenant: row.tenant.name,
      shipment: row.orders[0]
        ? {
            // Carried so the console can open what was actually posted to the
            // pharmacy for this fill, which is the only useful answer when they
            // say they never received it.
            orderId: row.orders[0].id,
            pharmacy: row.orders[0].pharmacy.name,
            status: row.orders[0].status,
            carrier: row.orders[0].carrier,
            trackingNumber: row.orders[0].trackingNumber,
          }
        : null,
      invoice: row.invoices[0]
        ? {
            id: row.invoices[0].id,
            number: row.invoices[0].number,
            status: row.invoices[0].status,
            totalCents: row.invoices[0].totalCents,
          }
        : null,
    }));

    return listResponse(data, total, query, PRESCRIPTION_SORT);
  }

  /**
   * Every visit on the platform, whoever sent it.
   *
   * The same derived `stage` a client sees on its own list, and the same SQL
   * predicate behind the filter — imported from the admin context rather than
   * restated here, because a platform total that disagreed with the client's
   * own count of the same visits would be a support call every time.
   *
   * Withdrawn visits are included, flagged. This is the console that withdrew
   * them, and the reason the row is kept is so this view can still show it.
   */
  async listVisits(
    query: ListQuery & { stage?: VisitStage; tenantId?: string; categorySlug?: string },
  ) {
    const where: Prisma.PrescriptionRequestWhereInput = {
      ...(query.stage ? visitStageWhere(query.stage) : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.categorySlug ? { category: { slug: query.categorySlug } } : {}),
      ...(searchAcross(query.q, [
        'externalMasterId',
        'patient.mrn',
        'patient.firstName',
        'patient.lastName',
        'patient.email',
        'patient.phone',
      ]) ?? {}),
      ...columnFilterWhere(query, VISIT_FILTERS),
    };

    const sort = safeSort(query.sort, VISIT_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.prescriptionRequest.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        include: {
          category: { select: { slug: true, name: true } },
          tenant: { select: { id: true, slug: true, name: true } },
          patient: {
            select: {
              id: true,
              mrn: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          submission: { select: { patientStateAtSubmission: true } },
          assignedProvider: { select: { user: { select: { firstName: true, lastName: true } } } },
          items: { select: { id: true, nameText: true, decision: true } },
          prescriptions: {
            orderBy: { signedAt: 'desc' },
            select: {
              status: true,
              signedAt: true,
              orders: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  status: true,
                  carrier: true,
                  trackingNumber: true,
                  shippedAt: true,
                  submittedAt: true,
                  lastError: true,
                  sellPriceCents: true,
                  costOfGoodsCents: true,
                  pharmacy: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.raw.prescriptionRequest.count({ where }),
    ]);

    const data = rows.map((row) => {
      const prescription = row.prescriptions[0] ?? null;
      const order = prescription?.orders[0] ?? null;

      return {
        id: row.id,
        masterId: row.externalMasterId,
        stage: visitStage({
          requestStatus: row.status,
          prescriptionStatus: prescription?.status,
          orderStatus: order?.status,
          orderError: order?.lastError,
          orderSubmittedAt: order?.submittedAt,
          signedAt: prescription?.signedAt,
        }),
        requestStatus: row.status,
        /** Withdrawn at a client's request. Shown here and nowhere else. */
        voidedAt: row.voidedAt,
        voidedReason: row.voidedReason,
        tenant: { id: row.tenant.id, slug: row.tenant.slug, name: row.tenant.name },
        category: { slug: row.category.slug, name: row.category.name },
        patient: {
          id: row.patient.id,
          mrn: row.patient.mrn,
          name: `${row.patient.firstName} ${row.patient.lastName}`,
          email: row.patient.email,
          phone: row.patient.phone,
        },
        patientState: row.submission.patientStateAtSubmission,
        provider: row.assignedProvider
          ? `${row.assignedProvider.user.firstName} ${row.assignedProvider.user.lastName}`
          : null,
        submittedAt: row.createdAt,
        updatedAt: row.updatedAt,
        decidedAt: row.decidedAt,
        refusedReason: row.status === 'DENIED' ? row.denialReason : null,
        items: row.items.map((item) => ({
          // Same medication can appear twice on one visit after a resend.
          id: item.id,
          name: item.nameText,
          decision: item.decision,
        })),
        shipment: order
          ? {
              pharmacy: order.pharmacy.name,
              status: order.status,
              carrier: order.carrier,
              trackingNumber: order.trackingNumber,
              shippedAt: order.shippedAt,
              error: order.lastError,
            }
          : null,
        /** What we charge and what it costs us. Never leaves this console. */
        money: order
          ? { sellPriceCents: order.sellPriceCents, costOfGoodsCents: order.costOfGoodsCents }
          : null,
      };
    });

    return listResponse(data, total, query, VISIT_SORT);
  }

  /**
   * The questionnaire behind a visit, decrypted.
   *
   * This is the most sensitive content the system holds — what a patient told a
   * clinician about their body, in their own words. It is encrypted at rest,
   * decrypted only here, and every read is break-the-glass.
   */
  async getVisitQuestionnaire(requestId: string, actorUserId: string) {
    // Deliberately not filtered on `voidedAt`. The platform owner is the one
    // who withdraws a visit, and the reason they need to read it afterwards is
    // the same reason the row is kept.
    const request = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: requestId },
      include: {
        category: { select: { slug: true, name: true } },
        tenant: { select: { name: true } },
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            addressLine1: true,
            city: true,
            residenceState: true,
            postalCode: true,
          },
        },
        assignedProvider: { include: { user: { select: { firstName: true, lastName: true } } } },
        items: true,
        submission: { include: { answers: { orderBy: { questionId: 'asc' } } } },
        prescriptions: { select: { id: true, status: true } },
      },
    });

    if (!request) throw new NotFoundException('Visit not found');

    await this.audit.record({
      action: 'BREAK_THE_GLASS',
      entityType: 'QaSubmission',
      entityId: request.submission.id,
      patientId: request.patientId,
      actorUserId,
      after: { reason: 'Super Admin viewed a questionnaire', visitId: requestId },
    });

    /** Questions arrive as Q1…Qn, which sorts wrongly as text past Q9. */
    const byQuestionNumber = (a: { questionId: string }, b: { questionId: string }) => {
      const n = (id: string) => Number(id.replace(/\D/g, '')) || 0;
      return n(a.questionId) - n(b.questionId);
    };

    const answers = [...request.submission.answers].sort(byQuestionNumber).map((answer) => {
      const stored = answer.valueJson as { encrypted?: string } | null;
      return {
        questionId: answer.questionId,
        question: answer.questionText ?? answer.questionId,
        answer: stored?.encrypted ? this.phi.decrypt(stored.encrypted) : '',
        answeredAt: answer.answeredAt,
      };
    });

    const rawValues = request.submission.valuesJson as { encrypted?: string } | null;
    const intake = rawValues?.encrypted
      ? (this.phi.decryptJson<Record<string, unknown>>(rawValues.encrypted) ?? {})
      : {};

    // The structured intake fields, separated from the free-form Q&A so the
    // clinical detail is not buried in an object dump.
    const CLINICAL_FIELDS = [
      ['allergies', 'Allergies'],
      ['medicalConditions', 'Medical conditions'],
      ['selfReportedMeds', 'Current medications'],
    ] as const;

    return {
      visitId: request.id,
      masterId: request.externalMasterId,
      status: request.status,
      /** Set if this visit has been withdrawn. Null is the normal case. */
      voidedAt: request.voidedAt?.toISOString() ?? null,
      voidedReason: request.voidedReason,
      category: request.category.name,
      tenant: request.tenant.name,
      patient: {
        id: request.patient.id,
        mrn: request.patient.mrn,
        name: `${request.patient.firstName} ${request.patient.lastName}`,
        // Returned so the console can pre-fill the correction form. Editing a
        // field whose current value is not on screen is how somebody overwrites
        // a good address with a blank one.
        email: request.patient.email,
        phone: request.patient.phone,
        address: request.patient.addressLine1,
        city: request.patient.city,
        state: request.patient.residenceState,
        zip: request.patient.postalCode,
      },
      provider: request.assignedProvider
        ? `${request.assignedProvider.user.firstName} ${request.assignedProvider.user.lastName}`
        : null,
      submittedAt: request.submission.submittedAt,
      patientStateAtSubmission: request.submission.patientStateAtSubmission,
      decidedAt: request.decidedAt,
      clinical: CLINICAL_FIELDS.map(([key, label]) => ({
        label,
        value: String(intake[key] ?? '—'),
      })),
      answers,
      requested: request.items.map((item) => ({
        // Two lines can carry the same medication name — a resend adds one
        // deliberately — so the row needs an identity of its own.
        id: item.id,
        name: item.nameText,
        strength: item.strength,
        quantity: item.quantity,
        refills: item.refills,
        decision: item.decision,
        reason: item.decisionReason,
        approvedStrength: item.approvedStrength,
        approvedQuantity: item.approvedQuantity,
      })),
      prescriptions: request.prescriptions,
    };
  }
}

/**
 * What this patient has been billed, across every client business they belong
 * to. Voided invoices are counted separately rather than folded into the total —
 * a void is a fact about the record, not an absence.
 */
function billingSummary(
  invoices: Array<{ status: string; totalCents: number }>,
): { invoices: number; billedCents: number; paidCents: number; voidedCents: number } {
  return {
    invoices: invoices.length,
    billedCents: invoices
      .filter((invoice) => invoice.status !== 'VOID')
      .reduce((sum, invoice) => sum + invoice.totalCents, 0),
    paidCents: invoices
      .filter((invoice) => invoice.status === 'PAID')
      .reduce((sum, invoice) => sum + invoice.totalCents, 0),
    voidedCents: invoices
      .filter((invoice) => invoice.status === 'VOID')
      .reduce((sum, invoice) => sum + invoice.totalCents, 0),
  };
}
