import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EntitlementsService } from '@/contexts/tenancy/entitlements.service';

/**
 * Handing a waiting visit to a named clinician.
 *
 * The retry sweep covers visits nobody could take *yet*. It cannot help the
 * other kind: nobody holds a licence in that state for that treatment, and no
 * amount of trying again changes it. Someone has to decide, and until now
 * nobody could — `assignedProviderId` was written only by the routing engine,
 * so a structurally unplaceable visit was unreachable even to the operator.
 *
 * What this does not do is bypass the gates. Licence and qualification are the
 * law and stay enforced here exactly as routing enforces them: a clinician not
 * licensed in the patient's state cannot be given the visit by anyone, at any
 * level of privilege. What it does override is **capacity**, which is an
 * operational limit we set ourselves — and overriding it is the entire reason a
 * human is in the loop.
 */
@Injectable()
export class ManualAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Who could be given this visit, and for the rest, why not. */
  async candidates(visitId: string) {
    const visit = await this.visit(visitId);
    const required = await this.requiredCategories(visit);

    const providers = await this.prisma.raw.providerProfile.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        maxOpenRequests: true,
        isAcceptingRequests: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        licenses: { where: { state: visit.state }, select: { status: true, expiresAt: true } },
        categories: { select: { categoryId: true } },
        _count: {
          select: {
            requests: { where: { status: { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] } } },
          },
        },
      },
      orderBy: { user: { lastName: 'asc' } },
    });

    return {
      state: visit.state,
      data: providers.map((provider) => {
        const licence = provider.licenses[0];
        const held = new Set(provider.categories.map((row) => row.categoryId));
        const blocker = this.blocker(licence, held, required);
        return {
          id: provider.id,
          name: `${provider.user.firstName} ${provider.user.lastName}`.trim(),
          email: provider.user.email,
          open: provider._count.requests,
          capacity: provider.maxOpenRequests,
          // Over capacity is shown, not hidden: it is the thing the operator is
          // deciding to override, so they need to see what it costs.
          atCapacity: provider._count.requests >= provider.maxOpenRequests,
          acceptingNew: provider.isAcceptingRequests,
          eligible: blocker === null,
          blocker,
        };
      }),
    };
  }

  async assign(visitId: string, providerId: string, reason: string, actorUserId: string) {
    const visit = await this.visit(visitId);
    if (visit.assignedProviderId) {
      throw new BadRequestException('That visit already has a clinician');
    }

    const required = await this.requiredCategories(visit);
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        status: true,
        user: { select: { email: true } },
        licenses: { where: { state: visit.state }, select: { status: true, expiresAt: true } },
        categories: { select: { categoryId: true } },
      },
    });
    if (!provider) throw new NotFoundException('That clinician does not exist');
    if (provider.status !== 'ACTIVE') {
      throw new BadRequestException('That clinician is not active');
    }

    const held = new Set(provider.categories.map((row) => row.categoryId));
    const blocker = this.blocker(provider.licenses[0], held, required);
    if (blocker) throw new BadRequestException(blocker);

    const assignedAt = new Date();
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.prescriptionRequest.update({
        where: { id: visit.id },
        data: { status: 'ASSIGNED', assignedProviderId: providerId, assignedAt },
      });
      await tx.prescriptionRequestItem.updateMany({
        where: { requestId: visit.id },
        data: { assignedProviderId: providerId, assignedAt },
      });
      // Written into the same log routing writes to, so the visit's history
      // reads as one account and a hand-placed visit is not indistinguishable
      // from an automatic one.
      await tx.routingAttempt.create({
        data: {
          requestId: visit.id,
          providerId,
          rule: 'manual',
          outcome: 'ASSIGNED',
          detail: `Assigned by the platform: ${reason}`,
        },
      });
    });

    await this.audit.record({
      action: 'REQUEST_ROUTED',
      entityType: 'PrescriptionRequest',
      entityId: visit.id,
      patientId: visit.patientId,
      actorUserId,
      after: { assignedProviderId: providerId, manual: true, reason },
    });

    return { assigned: true, providerId, email: provider.user.email };
  }

  /**
   * The gates, in the order they matter.
   *
   * Licence and qualification first because they are not ours to waive.
   * Capacity is deliberately absent: it is the limit this endpoint exists to
   * override.
   */
  private blocker(
    licence: { status: string; expiresAt: Date } | undefined,
    held: Set<string>,
    required: Set<string>,
  ): string | null {
    if (!licence) return 'No licence in the patient’s state';
    if (licence.status !== 'ACTIVE') return `Licence is ${licence.status.toLowerCase()}`;
    if (licence.expiresAt <= new Date()) return 'Licence has expired';
    if (required.size && ![...required].some((id) => held.has(id))) {
      return 'Not credentialled for this treatment';
    }
    return null;
  }

  private async requiredCategories(visit: {
    categoryId: string;
    items: Array<{ medicationId: string }>;
  }): Promise<Set<string>> {
    const byMedication = await this.entitlements.categoriesForMedications(
      visit.items.map((item) => item.medicationId),
    );
    const required = new Set<string>();
    for (const item of visit.items) {
      const ids = byMedication.get(item.medicationId) ?? [];
      for (const id of ids.length ? ids : [visit.categoryId]) required.add(id);
    }
    return required.size ? required : new Set([visit.categoryId]);
  }

  private async visit(visitId: string) {
    const visit = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        patientId: true,
        categoryId: true,
        assignedProviderId: true,
        patient: { select: { residenceState: true } },
        submission: { select: { patientStateAtSubmission: true } },
        items: { select: { medicationId: true } },
      },
    });
    if (!visit) throw new NotFoundException('That visit does not exist');

    return {
      ...visit,
      // The state as it was at submission, matching what routing judged.
      state: visit.submission?.patientStateAtSubmission ?? visit.patient.residenceState,
    };
  }
}
