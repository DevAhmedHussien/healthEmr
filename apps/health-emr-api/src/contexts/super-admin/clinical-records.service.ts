import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

/**
 * Erasing and withdrawing the records themselves.
 *
 * The rule is one sentence and the rest of this file is its consequences: a
 * clinical record that was finalised is never erased, only marked. A clinician
 * approved or refused something, or signed a prescription, and that happened —
 * a retention period measured in years exists precisely so that the record of
 * it cannot be removed by whoever finds it inconvenient later.
 *
 * What *can* be erased is the visit that never reached a clinician. An intake
 * posted twice by a client's server, a test submission, a form abandoned
 * halfway. Nobody decided anything, so there is no decision to retain.
 *
 * Withdrawing is the answer everywhere else, and it is not a weaker delete: the
 * record stays whole, stops appearing in the lists people work from, and says
 * on its face that it was entered in error and who said so.
 */
@Injectable()
export class ClinicalRecordsService {
  private readonly logger = new Logger(ClinicalRecordsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Whether this visit may be erased, and if not, why not — in the words the
   * console will show on a disabled button.
   */
  async inspectVisit(id: string): Promise<ClinicalDeletionReport> {
    const visit = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id },
      select: {
        id: true,
        externalMasterId: true,
        status: true,
        decidedAt: true,
        voidedAt: true,
        _count: { select: { prescriptions: true } },
      },
    });
    if (!visit) throw new NotFoundException('That visit does not exist');

    const orders = await this.prisma.raw.pharmacyOrder.count({
      where: { prescription: { requestId: id } },
    });
    const reason = whyVisitIsFinal(visit, orders);

    return {
      kind: 'visit',
      id,
      confirmPhrase: visit.externalMasterId,
      finalised: reason !== null,
      deletable: reason === null,
      reason,
      archived: visit.voidedAt !== null,
      alternative: reason === null ? null : WITHDRAW_INSTEAD,
    };
  }

  /**
   * Erase a visit that never reached a clinician.
   *
   * Its intake answers and encounter go with it — they are the same event
   * recorded in three tables, and keeping two thirds of a visit nobody ever
   * read is not retention, it is litter. Anything a clinician touched is
   * refused above and withdrawn instead.
   */
  async removeVisit(id: string, reason: string, actor: AuthenticatedUser) {
    const report = await this.inspectVisit(id);
    if (!report.deletable) {
      throw new ConflictException(`This visit cannot be erased: ${report.reason}. ${WITHDRAW_INSTEAD}`);
    }

    const before = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id },
      select: {
        id: true,
        externalMasterId: true,
        status: true,
        tenantId: true,
        patientId: true,
        createdAt: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!before) throw new NotFoundException('That visit does not exist');

    // Before the transaction and outside it — the trail is hash-chained on a
    // monotonic sequence, and a rolled-back entry leaves a gap that reads as
    // tampering. A failure gets a second entry rather than the first removed.
    await this.audit.record({
      action: 'PHI_DELETED',
      entityType: 'PrescriptionRequest',
      entityId: id,
      patientId: before.patientId,
      tenantId: before.tenantId,
      tenantSlug: before.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before,
      after: { deleted: true, reason },
    });

    try {
      await this.prisma.raw.$transaction(async (tx) => {
        // Re-read inside the transaction against its own snapshot. A visit can
        // be assigned and decided in the time between a console reading it and
        // a person pressing the button, and the decision that matters is the
        // one true at the moment the row goes.
        const now = await tx.prescriptionRequest.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            decidedAt: true,
            voidedAt: true,
            _count: { select: { prescriptions: true } },
          },
        });
        if (!now) throw new NotFoundException('That visit does not exist');

        const orders = await tx.pharmacyOrder.count({ where: { prescription: { requestId: id } } });
        const stillFinal = whyVisitIsFinal(now, orders);
        if (stillFinal) {
          throw new ConflictException(`This visit cannot be erased: ${stillFinal}. ${WITHDRAW_INSTEAD}`);
        }

        await tx.prescriptionRequest.delete({ where: { id } });
      });
    } catch (cause) {
      await this.audit.record({
        action: 'PHI_DELETED',
        entityType: 'PrescriptionRequest',
        entityId: id,
        patientId: before.patientId,
        tenantId: before.tenantId,
        tenantSlug: before.tenant.slug,
        actorUserId: actor.id,
        actorRole: actor.role,
        before,
        after: {
          deleted: false,
          rolledBack: true,
          reason,
          failure: cause instanceof Error ? cause.message : 'unknown',
        },
      });
      this.logger.error(`Rolled back the deletion of visit ${id}`, cause as Error);
      throw cause;
    }

    return { removed: true, kind: 'visit' as const, id };
  }

  /**
   * A prescription is never erased.
   *
   * `PrescriptionStatus` begins at SIGNED and `signedAt` cannot be null: a row
   * exists here only because a clinician put their name to it. There is no
   * draft to clean up, so the only honest answer the console can give is a
   * disabled button with the reason on it.
   */
  async inspectPrescription(id: string): Promise<ClinicalDeletionReport> {
    const prescription = await this.prisma.raw.prescription.findUnique({
      where: { id },
      select: { id: true, signedAt: true, voidedAt: true, request: { select: { externalMasterId: true } } },
    });
    if (!prescription) throw new NotFoundException('That prescription does not exist');

    return {
      kind: 'prescription',
      id,
      confirmPhrase: prescription.request?.externalMasterId ?? null,
      finalised: true,
      deletable: false,
      reason: 'it was signed by a clinician, and a signed prescription is kept',
      archived: prescription.voidedAt !== null,
      alternative: WITHDRAW_INSTEAD,
    };
  }

  /**
   * Withdraw a prescription: entered in error, kept, and marked as such.
   *
   * Which is the whole of what may happen to it. The reason is required for
   * the same purpose the record is retained for — somebody will read this row
   * years from now and the only thing that will explain it is this sentence.
   */
  async archivePrescription(id: string, reason: string, actor: AuthenticatedUser) {
    const prescription = await this.prisma.raw.prescription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        voidedAt: true,
        tenantId: true,
        patientId: true,
        tenant: { select: { slug: true } },
        orders: { select: { id: true, status: true } },
      },
    });
    if (!prescription) throw new NotFoundException('That prescription does not exist');
    if (prescription.voidedAt) throw new BadRequestException('That prescription is already withdrawn');

    const shipped = prescription.orders.filter((order) =>
      (['SHIPPED', 'DELIVERED'] as string[]).includes(order.status),
    );
    if (shipped.length) {
      // The parcel exists and the patient may already be taking what is in it.
      // Marking the prescription entered-in-error would leave the dispensing
      // record describing something the chart says never should have happened.
      throw new ConflictException(
        'This prescription has already shipped. Withdrawing it would contradict the dispensing ' +
          'record — raise the correction on the visit instead.',
      );
    }

    const updated = await this.prisma.raw.prescription.update({
      where: { id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedReason: reason,
        voidedByUserId: actor.id,
      },
      select: { id: true, status: true, voidedAt: true },
    });

    await this.audit.record({
      action: 'PRESCRIPTION_VOIDED',
      entityType: 'Prescription',
      entityId: id,
      patientId: prescription.patientId,
      tenantId: prescription.tenantId,
      tenantSlug: prescription.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before: { status: prescription.status, voidedAt: null },
      after: { status: updated.status, voidedAt: updated.voidedAt, reason },
    });

    return { id, archived: true };
  }

  /** Put one back, when the withdrawal was itself the mistake. */
  async restorePrescription(id: string, actor: AuthenticatedUser) {
    const prescription = await this.prisma.raw.prescription.findUnique({
      where: { id },
      select: {
        id: true,
        voidedAt: true,
        voidedReason: true,
        tenantId: true,
        patientId: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!prescription) throw new NotFoundException('That prescription does not exist');
    if (!prescription.voidedAt) throw new BadRequestException('That prescription is not withdrawn');

    await this.prisma.raw.prescription.update({
      where: { id },
      data: { status: 'SIGNED', voidedAt: null, voidedReason: null, voidedByUserId: null },
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'Prescription',
      entityId: id,
      patientId: prescription.patientId,
      tenantId: prescription.tenantId,
      tenantSlug: prescription.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before: { voidedAt: prescription.voidedAt.toISOString(), reason: prescription.voidedReason },
      after: { voidedAt: null, status: 'SIGNED' },
    });

    return { id, restored: true };
  }
}

/**
 * Why this visit counts as finalised, or null if nothing has happened to it yet.
 *
 * Four separate questions, because a visit can arrive at "a clinician dealt
 * with this" by four routes and any one of them is enough. A refusal is as much
 * a clinical decision as an approval — somebody read the intake and said no,
 * and the reason they said no is exactly what gets asked about later.
 */
export function whyVisitIsFinal(
  visit: {
    status: string;
    decidedAt: Date | null;
    _count: { prescriptions: number };
  },
  orderCount: number,
): string | null {
  if (visit.decidedAt) return 'a clinician has already decided it';
  if (visit.status === 'APPROVED') return 'it was approved';
  if (visit.status === 'DENIED') return 'it was refused, and the refusal is a clinical decision';
  if (visit._count.prescriptions > 0) return 'a prescription was written on it';
  if (orderCount > 0) return 'it reached a pharmacy';
  return null;
}

export interface ClinicalDeletionReport {
  kind: 'visit' | 'prescription';
  id: string;
  /** What has to be typed to confirm. The master id, which is what is on screen. */
  confirmPhrase: string | null;
  finalised: boolean;
  deletable: boolean;
  /** Why not, phrased to be read on a disabled button. Null when it may go. */
  reason: string | null;
  archived: boolean;
  alternative: string | null;
}

const WITHDRAW_INSTEAD =
  'Withdraw it instead — it is marked as entered in error, hidden from the lists, and kept.';
