import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Role,
  VISIT_STAGES,
  visitStage,
  type ListQuery,
  type VisitStage,
} from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import { ObjectStorageService } from '@/shared/storage/object-storage.service';
import {
  buildOrderBy,
  listResponse,
  mergeWhere,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';
import { ChartSection, canSee, visibleSections } from './redaction.policy';
import { visitStageWhere } from './visit-stage.filter';

export const ADMIN_PATIENT_SORT = ['createdAt', 'lastName', 'mrn', 'residenceState'] as const;
export const ADMIN_VISIT_SORT = ['createdAt', 'decidedAt', 'status'] as const;
export const ADMIN_PRESCRIPTION_SORT = ['signedAt', 'status'] as const;

/**
 * Filterable columns of the client's own tables, keyed by the column id.
 *
 * The same columns the platform owner can filter, minus the ones that only
 * exist on the platform view — a client has one account, so filtering by it
 * would be filtering by a constant.
 */
export const ADMIN_PATIENT_FILTERS = {
  mrn: { path: 'mrn', kind: 'text' },
  lastName: { path: 'lastName', kind: 'name', paths: ['firstName', 'lastName'] },
  visits: { path: 'requests', kind: 'presence' },
  prescriptions: { path: 'prescriptions', kind: 'presence' },
  allergies: { path: 'allergies', kind: 'presence' },
  email: { path: 'email', kind: 'text' },
  phone: { path: 'phone', kind: 'text' },
  residenceState: { path: 'residenceState', kind: 'exact' },
  sexAtBirth: { path: 'sexAtBirth', kind: 'exact', values: ['MALE', 'FEMALE'] },
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

export const ADMIN_VISIT_FILTERS = {
  masterId: { path: 'externalMasterId', kind: 'text' },
  patient: {
    path: 'patient.lastName',
    kind: 'name',
    paths: ['patient.firstName', 'patient.lastName'],
  },
  // The column shows "Weight Loss" and the slug is `weightloss`, so an exact
  // match on either alone fails for whatever the reader actually typed.
  category: {
    path: 'category.name',
    kind: 'name',
    paths: ['category.name', 'category.slug'],
  },
  requestStatus: {
    path: 'status',
    kind: 'exact',
    values: ['RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED'],
  },
  provider: {
    path: 'assignedProvider.user.lastName',
    kind: 'name',
    paths: ['assignedProvider.user.firstName', 'assignedProvider.user.lastName'],
  },
  patientState: { path: 'submission.patientStateAtSubmission', kind: 'exact' },
  reason: { path: 'denialReason', kind: 'text' },
  shipment: { path: 'prescriptions[].orders[].status', kind: 'exact', values: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT', 'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED'] },
  tracking: { path: 'prescriptions[].orders[].trackingNumber', kind: 'text' },
  createdAt: { path: 'createdAt', kind: 'date' },
  decidedAt: { path: 'decidedAt', kind: 'date' },
  updatedAt: { path: 'updatedAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

export const ADMIN_PRESCRIPTION_FILTERS = {
  medication: { path: 'medication.name', kind: 'text' },
  patient: {
    path: 'patient.lastName',
    kind: 'name',
    paths: ['patient.firstName', 'patient.lastName'],
  },
  prescriber: { path: 'providerNameSnapshot', kind: 'text' },
  // Rendered as `AZ-12345 (AZ)`, from two columns.
  licence: {
    path: 'licenseNumberSnapshot',
    kind: 'name',
    paths: ['licenseNumberSnapshot', 'licenseStateSnapshot'],
  },
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
 * A client business's own clinical records.
 *
 * The same tables the platform owner sees, narrowed to one tenant. That
 * narrowing is not done by adding `WHERE tenantId` here and hoping every future
 * query remembers: the Prisma extension applies it beneath this service, and the
 * explicit clauses below are belt to that braces — they make the intent readable
 * at the call site and keep the counts honest.
 *
 * What differs from the platform view is the audit posture. Super Admin reads
 * across every tenant, so every chart it opens is break-the-glass. A business
 * reading its own patients is routine, so it is recorded as an ordinary PHI read
 * — still logged, because "who looked at this chart" has to be answerable either
 * way, but not flagged as an exception when it is not one.
 */
/**
 * A visit the platform has withdrawn is not this client's visit any more.
 *
 * Spread into every read rather than asserted once, because these queries run
 * on `prisma.raw` and nothing else will catch a query that forgets. Named so
 * that forgetting it is visible in review.
 */
const NOT_WITHDRAWN = { voidedAt: null } as const;

@Injectable()
export class AdminClinicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorageService,
  ) {}

  // ─── Overview ──────────────────────────────────────────────────────────────

  /**
   * How many visits sit at each stage right now.
   *
   * Counted with the same predicates the list filters by, so a tile reading "3
   * stuck" and the table you reach by clicking it can never disagree. Ten counts
   * in parallel rather than one grouped query, because the stages are not a
   * column — they are derived, and `GROUP BY` has nothing to group on.
   */
  async overview(tenantId: string) {
    const now = new Date();

    const counts = await Promise.all(
      VISIT_STAGES.map(async (stage) => ({
        stage,
        count: await this.prisma.raw.prescriptionRequest.count({
          where: { tenantId, ...NOT_WITHDRAWN, ...visitStageWhere(stage, now) },
        }),
      })),
    );

    const [patients, prescriptions] = await Promise.all([
      this.prisma.raw.patient.count({ where: { tenantLinks: { some: { tenantId } } } }),
      this.prisma.raw.prescription.count({ where: { tenantId } }),
    ]);

    return {
      stages: counts,
      totals: {
        visits: counts.reduce((sum, row) => sum + row.count, 0),
        patients,
        prescriptions,
      },
    };
  }

  // ─── Patients ──────────────────────────────────────────────────────────────

  async listPatients(tenantId: string, query: ListQuery & { state?: string }) {
    const mine: Prisma.PatientWhereInput = { tenantLinks: { some: { tenantId } } };

    const where: Prisma.PatientWhereInput = {
      ...mine,
      ...(query.state ? { residenceState: query.state } : {}),
      ...(searchAcross(query.q, ['firstName', 'lastName', 'mrn', 'email', 'phone']) ?? {}),
      ...columnFilterWhere(query, ADMIN_PATIENT_FILTERS),
    };

    const sort = safeSort(query.sort, ADMIN_PATIENT_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.patient.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        select: {
          id: true, mrn: true, firstName: true, lastName: true, email: true, phone: true,
          residenceState: true, sexAtBirth: true, createdAt: true,
          _count: { select: { allergies: true } },
          // Counted through the tenant, not globally: a patient who also buys
          // from another business must not have that visible here, and a count
          // is a disclosure like any other.
          requests: { where: { tenantId }, select: { id: true } },
          prescriptions: { where: { tenantId }, select: { id: true } },
        },
      }),
      this.prisma.raw.patient.count({ where }),
      // "of 412" has to mean "of my 412", or the unfiltered state quietly
      // reports how big the whole platform is.
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      mrn: row.mrn,
      name: `${row.firstName} ${row.lastName}`,
      email: row.email,
      phone: row.phone,
      state: row.residenceState,
      sexAtBirth: row.sexAtBirth,
      visits: row.requests.length,
      prescriptions: row.prescriptions.length,
      allergies: row._count.allergies,
      createdAt: row.createdAt,
    }));

    return listResponse(data, total, query, ADMIN_PATIENT_SORT);
  }

  // ─── Visits ────────────────────────────────────────────────────────────────

  async listVisits(
    tenantId: string,
    query: ListQuery & { stage?: VisitStage; categorySlug?: string },
  ) {
    const mine: Prisma.PrescriptionRequestWhereInput = { tenantId, ...NOT_WITHDRAWN };

    const where: Prisma.PrescriptionRequestWhereInput = mergeWhere<Prisma.PrescriptionRequestWhereInput>(
      mine,
      query.stage ? visitStageWhere(query.stage) : undefined,
      query.categorySlug ? { category: { slug: query.categorySlug } } : undefined,
      searchAcross(query.q, [
        'externalMasterId',
        'patient.mrn',
        'patient.firstName',
        'patient.lastName',
        'patient.email',
      ]),
      columnFilterWhere(query, ADMIN_VISIT_FILTERS),
    );

    const sort = safeSort(query.sort, ADMIN_VISIT_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.prescriptionRequest.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        include: {
          category: { select: { slug: true, name: true } },
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          submission: { select: { patientStateAtSubmission: true, submittedAt: true } },
          assignedProvider: { select: { user: { select: { firstName: true, lastName: true } } } },
          items: { select: { nameText: true, decision: true } },
          prescriptions: {
            orderBy: { signedAt: 'desc' },
            select: {
              id: true, status: true, signedAt: true,
              orders: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  status: true, carrier: true, trackingNumber: true, shippedAt: true,
                  submittedAt: true, lastError: true,
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
        category: { slug: row.category.slug, name: row.category.name },
        patient: {
          id: row.patient.id,
          mrn: row.patient.mrn,
          name: `${row.patient.firstName} ${row.patient.lastName}`,
        },
        patientState: row.submission.patientStateAtSubmission,
        provider: row.assignedProvider
          ? `${row.assignedProvider.user.firstName} ${row.assignedProvider.user.lastName}`
          : null,
        submittedAt: row.createdAt,
        /** When anything on this visit last moved. */
        updatedAt: row.updatedAt,
        decidedAt: row.decidedAt,
        // That a refusal happened is commercial; why it happened is clinical.
        // A support desk that cannot see the first cannot answer the phone.
        refusedReason: row.status === 'DENIED' ? row.denialReason : null,
        items: row.items.map((item) => ({ name: item.nameText, decision: item.decision })),
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
      };
    });

    return listResponse(data, total, query, ADMIN_VISIT_SORT);
  }

  /**
   * One visit in full, subject to the redaction policy.
   *
   * The policy decides which sections are included; this method does not
   * second-guess it. Two places deciding the same access question is how they
   * come to disagree, and the one that disagrees quietly is the leak.
   */
  async getVisit(tenantId: string, visitId: string, actorUserId: string) {
    const visit = await this.prisma.raw.prescriptionRequest.findFirst({
      where: { id: visitId, tenantId, ...NOT_WITHDRAWN },
      include: {
        category: { select: { slug: true, name: true } },
        items: true,
        submission: {
          include: {
            answers: { orderBy: { questionId: 'asc' } },
            template: { select: { version: true } },
          },
        },
        assignedProvider: { select: { user: { select: { firstName: true, lastName: true } } } },
        patient: {
          include: {
            allergies: { where: { status: 'ACTIVE' } },
            conditions: { where: { clinicalStatus: 'ACTIVE' } },
            medications: { where: { status: 'ACTIVE' } },
            documents: {
              where: { kind: { in: ['ID_PHOTO', 'RX_PHOTO'] } },
              orderBy: { createdAt: 'desc' },
              select: { id: true, kind: true, mime: true, size: true, fileName: true, createdAt: true },
            },
          },
        },
        prescriptions: {
          orderBy: { signedAt: 'desc' },
          include: {
            medication: { select: { name: true, strength: true } },
            orders: {
              orderBy: { createdAt: 'desc' },
              include: { pharmacy: { select: { name: true } } },
            },
            invoices: { select: { id: true, number: true, status: true, totalCents: true }, take: 1 },
          },
        },
      },
    });

    if (!visit) throw new NotFoundException('Visit not found');

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'PrescriptionRequest',
      entityId: visitId,
      patientId: visit.patientId,
      tenantId,
      actorUserId,
      after: { role: Role.ADMIN, sections: visibleSections(Role.ADMIN).length },
    });

    const prescription = visit.prescriptions[0] ?? null;
    const order = prescription?.orders[0] ?? null;

    return {
      id: visit.id,
      masterId: visit.externalMasterId,
      stage: visitStage({
        requestStatus: visit.status,
        prescriptionStatus: prescription?.status,
        orderStatus: order?.status,
        orderError: order?.lastError,
        orderSubmittedAt: order?.submittedAt,
        signedAt: prescription?.signedAt,
      }),
      requestStatus: visit.status,
      category: { slug: visit.category.slug, name: visit.category.name },
      submittedAt: visit.submission.submittedAt.toISOString(),
      decidedAt: visit.decidedAt,
      refusedReason: visit.status === 'DENIED' ? visit.denialReason : null,
      provider: visit.assignedProvider
        ? `${visit.assignedProvider.user.firstName} ${visit.assignedProvider.user.lastName}`
        : null,
      /** Where the patient physically was, which is what licensure follows. */
      patientState: visit.submission.patientStateAtSubmission,

      patient: {
        id: visit.patient.id,
        mrn: visit.patient.mrn,
        name: `${visit.patient.firstName} ${visit.patient.lastName}`,
        dateOfBirth: this.phi.decrypt(visit.patient.dob),
        sexAtBirth: visit.patient.sexAtBirth,
        email: visit.patient.email,
        phone: visit.patient.phone,
        shipTo: [
          visit.patient.addressLine1,
          visit.patient.addressLine2,
          visit.patient.city,
          visit.patient.residenceState,
          visit.patient.postalCode,
        ]
          .filter(Boolean)
          .join(', '),
      },

      clinical: canSee(Role.ADMIN, ChartSection.ALLERGIES)
        ? {
            allergies: visit.patient.allergies.map((row) => ({
              substance: row.substance,
              severity: row.severity,
              reaction: row.reactionText,
            })),
            conditions: visit.patient.conditions.map((row) => row.display),
            medications: visit.patient.medications.map((row) =>
              [row.nameText, row.dose].filter(Boolean).join(' '),
            ),
          }
        : null,

      questionnaire: canSee(Role.ADMIN, ChartSection.QA_ANSWERS)
        ? {
            name: visit.category.name,
            version: visit.submission.templateVersion,
            answers: visit.submission.answers.map((answer) => ({
              questionId: answer.questionId,
              question: answer.questionText ?? '',
              answer: this.readAnswer(answer.valueJson),
            })),
          }
        : null,

      /** Ids only. The bytes come one at a time from the photo endpoint. */
      photos: canSee(Role.ADMIN, ChartSection.CLINICAL_IMAGES)
        ? visit.patient.documents.map((document) => ({
            id: document.id,
            kind: document.kind,
            mime: document.mime,
            size: document.size,
            fileName: document.fileName,
            uploadedAt: document.createdAt.toISOString(),
          }))
        : [],

      requested: visit.items.map((item) => ({
        id: item.id,
        name: item.nameText,
        strength: item.strength,
        quantity: item.quantity,
        refills: item.refills,
        daysSupply: item.daysSupply,
        kitCode: item.kitCode,
        decision: item.decision,
      })),

      prescriptions: visit.prescriptions.map((row) => ({
        id: row.id,
        medication: row.medication.name,
        strength: row.medication.strength,
        dose: row.dose,
        quantity: row.quantity,
        refills: row.refills,
        sig: row.sig,
        status: row.status,
        signedAt: row.signedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        prescriber: row.providerNameSnapshot,
        licence: `${row.licenseNumberSnapshot} (${row.licenseStateSnapshot})`,
        invoice: row.invoices[0] ?? null,
        orders: row.orders.map((entry) => ({
          id: entry.id,
          pharmacy: entry.pharmacy.name,
          status: entry.status,
          carrier: entry.carrier,
          trackingNumber: entry.trackingNumber,
          submittedAt: entry.submittedAt,
          shippedAt: entry.shippedAt,
          deliveredAt: entry.deliveredAt,
          attempts: entry.attempts,
          error: entry.lastError,
        })),
      })),

      // Named rather than silently absent: a UI that knows a section was
      // withheld can say so, where one that sees an empty array will tell the
      // user there are no notes — a different and false statement.
      redactedSections: [ChartSection.PROVIDER_NOTES, ChartSection.LAB_RESULTS].filter(
        (section) => !canSee(Role.ADMIN, section),
      ),
    };
  }

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  async listPrescriptions(tenantId: string, query: ListQuery & { status?: string }) {
    // Through the visit, because a prescription has no withdrawal of its own —
    // withdrawing the visit is what takes its prescriptions with it.
    const mine: Prisma.PrescriptionWhereInput = { tenantId, request: NOT_WITHDRAWN };

    const where: Prisma.PrescriptionWhereInput = {
      ...mine,
      ...(query.status ? { status: query.status as never } : {}),
      ...(searchAcross(query.q, ['patient.mrn', 'patient.lastName', 'medication.name']) ?? {}),
      ...columnFilterWhere(query, ADMIN_PRESCRIPTION_FILTERS),
    };

    const sort = safeSort(query.sort, ADMIN_PRESCRIPTION_SORT, 'signedAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.prescription.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        include: {
          medication: { select: { name: true, strength: true } },
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          request: { select: { id: true, externalMasterId: true, status: true } },
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

    const data = rows.map((row) => {
      const order = row.orders[0] ?? null;

      return {
        id: row.id,
        visitId: row.request.id,
        masterId: row.request.externalMasterId,
        medication: row.medication.name,
        dose: row.dose,
        quantity: row.quantity,
        refills: row.refills,
        status: row.status,
        // The same one-line answer the visit list gives, so a prescription and
        // the visit it came from never appear to be in two different places.
        stage: visitStage({
          requestStatus: row.request.status,
          prescriptionStatus: row.status,
          orderStatus: order?.status,
          orderError: order?.lastError,
          orderSubmittedAt: order?.submittedAt,
          signedAt: row.signedAt,
        }),
        signedAt: row.signedAt,
        prescriber: row.providerNameSnapshot,
        licence: `${row.licenseNumberSnapshot} (${row.licenseStateSnapshot})`,
        patient: {
          id: row.patient.id,
          mrn: row.patient.mrn,
          name: `${row.patient.firstName} ${row.patient.lastName}`,
        },
        shipment: order
          ? {
              pharmacy: order.pharmacy.name,
              status: order.status,
              carrier: order.carrier,
              trackingNumber: order.trackingNumber,
              error: order.lastError,
            }
          : null,
        invoice: row.invoices[0] ?? null,
      };
    });

    return listResponse(data, total, query, ADMIN_PRESCRIPTION_SORT);
  }

  // ─── Photos ────────────────────────────────────────────────────────────────

  /**
   * One photograph from one of this business's visits.
   *
   * Reached through the visit, so a document id on its own opens nothing, and
   * recorded — looking at somebody's identification is a look at their chart
   * whatever the interface calls it.
   */
  async visitPhoto(tenantId: string, visitId: string, documentId: string, actorUserId: string) {
    if (!canSee(Role.ADMIN, ChartSection.CLINICAL_IMAGES)) {
      throw new NotFoundException('Photo not found');
    }

    const visit = await this.prisma.raw.prescriptionRequest.findFirst({
      where: { id: visitId, tenantId, ...NOT_WITHDRAWN },
      select: { patientId: true },
    });
    if (!visit) throw new NotFoundException('Visit not found');

    const document = await this.prisma.raw.patientDocument.findFirst({
      where: { id: documentId, patientId: visit.patientId, kind: { in: ['ID_PHOTO', 'RX_PHOTO'] } },
      select: { bucket: true, objectKey: true, mime: true },
    });
    if (!document) throw new NotFoundException('Photo not found');

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'PatientDocument',
      entityId: documentId,
      patientId: visit.patientId,
      tenantId,
      actorUserId,
      after: { visitId, reason: 'Client business viewed an uploaded photo' },
    });

    return { mime: document.mime, body: await this.storage.get(document.bucket, document.objectKey) };
  }

  /**
   * Renders one stored answer.
   *
   * Intake writes `{ encrypted: "phi.v1:…" }` — the ciphertext wrapped in an
   * object, because jsonb wants a document rather than a bare string. Anything
   * unreadable is reported as such rather than shown blank: nothing next to
   * "Are you pregnant?" reads as "no".
   */
  private readAnswer(value: unknown): string {
    const stored =
      value && typeof value === 'object' && 'encrypted' in value
        ? (value as { encrypted: unknown }).encrypted
        : value;

    if (typeof stored !== 'string') return String(stored ?? '');

    try {
      return this.phi.decrypt(stored);
    } catch {
      return '[could not be read]';
    }
  }
}
