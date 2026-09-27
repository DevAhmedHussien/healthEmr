import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { EntitlementsService } from '@/contexts/tenancy/entitlements.service';
import { RoutingService } from './routing.service';

/** How long a visit may sit unassigned before it stops being retried. */
const GIVE_UP_AFTER_HOURS = 72;

/** Most visits to attempt in one pass, so a large backlog cannot stall the tick. */
const BATCH = 25;

/**
 * Tries again for visits nobody could take yet.
 *
 * Routing runs once, when the visit arrives. That is fine when it fails
 * structurally — nobody is licensed in the patient's state, and no amount of
 * waiting changes it — but most failures are not structural. Every clinician
 * being at capacity is a condition that resolves the moment one of them
 * finishes a review, and without this the visit stayed PENDING_ASSIGNMENT for
 * ever: the system correctly labelled the problem temporary and then had no way
 * to ever look again. A patient who had already paid waited on a queue nobody
 * was watching.
 *
 * So this re-runs the same routing decision on the same visit. It does not
 * bypass any gate — a visit is placed only if it would have been placed had it
 * arrived now, and every attempt is recorded exactly as the first one was, so
 * the trail reads as one continuous account of who was considered and why.
 */
@Injectable()
export class AssignmentRetryService {
  private readonly logger = new Logger(AssignmentRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - GIVE_UP_AFTER_HOURS * 3_600_000);

    // Deliberately unscoped: this spans every client business, and runs for no
    // one — there is no request and so no tenant in context.
    const waiting = await this.prisma.raw.prescriptionRequest.findMany({
      where: {
        status: 'PENDING_ASSIGNMENT',
        assignedProviderId: null,
        voidedAt: null,
        createdAt: { gt: cutoff },
      },
      select: {
        id: true,
        tenantId: true,
        categoryId: true,
        patient: { select: { residenceState: true } },
        submission: { select: { patientStateAtSubmission: true } },
        items: { select: { id: true, medicationId: true, nameText: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });

    if (!waiting.length) return;

    let placed = 0;
    for (const visit of waiting) {
      try {
        if (await this.place(visit)) placed += 1;
      } catch (cause) {
        // One unplaceable visit must not stop the rest of the batch.
        this.logger.error(
          `Retry failed for visit ${visit.id}: ${cause instanceof Error ? cause.message : cause}`,
        );
      }
    }

    if (placed) {
      this.logger.log(`Assigned ${placed} of ${waiting.length} visit(s) that were waiting`);
    }
  }

  private async place(visit: {
    id: string;
    tenantId: string;
    categoryId: string;
    patient: { residenceState: string };
    submission: { patientStateAtSubmission: string | null } | null;
    items: Array<{ id: string; medicationId: string; nameText: string }>;
  }): Promise<boolean> {
    // The state as it was when they submitted, not where they live now. Routing
    // is a statement about that moment, and a patient who has since moved must
    // not silently change who was allowed to review it.
    const patientState =
      visit.submission?.patientStateAtSubmission ?? visit.patient?.residenceState;
    if (!patientState || !visit.items.length) return false;

    const categories = await this.entitlements.categoriesForMedications(
      visit.items.map((item) => item.medicationId),
    );

    const decision = await this.routing.routeVisit({
      tenantId: visit.tenantId,
      patientState,
      fallbackCategoryId: visit.categoryId,
      lines: visit.items.map((item) => ({
        key: item.id,
        label: item.nameText,
        categoryIds: categories.get(item.medicationId) ?? [],
      })),
    });

    // Every attempt is recorded, placed or not. A visit that has been tried
    // forty times and refused for the same reason each time is the signal that
    // somebody needs to recruit in that state, and that only shows if the
    // failures are written down.
    await this.routing.recordAttempts(visit.id, decision.attempts);

    if (!decision.assignedProviderId) return false;

    const assignedTo = new Map(decision.lines.map((line) => [line.key, line.providerId]));
    const assignedAt = new Date();

    await this.prisma.raw.$transaction(async (tx) => {
      await tx.prescriptionRequest.update({
        where: { id: visit.id },
        data: {
          status: 'ASSIGNED',
          assignedProviderId: decision.assignedProviderId,
          assignedAt,
        },
      });

      await Promise.all(
        visit.items.map((item) =>
          tx.prescriptionRequestItem.update({
            where: { id: item.id },
            data: {
              assignedProviderId: assignedTo.get(item.id) ?? null,
              assignedAt: assignedTo.has(item.id) ? assignedAt : null,
            },
          }),
        ),
      );
    });

    return true;
  }
}
