import { Injectable, Logger } from '@nestjs/common';
import type { RequestStatus } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

/**
 * What a provider has earned.
 *
 * Recorded on a completed review — approve or deny. The clinical work is
 * identical either way, and paying only for approvals would give a provider a
 * financial reason to approve a request that should be declined.
 */
@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the rate, most specific first: this provider and this category,
   * then this provider, then the platform default. Only schedules in effect at
   * `at` are considered, so a rate change does not silently restate history.
   */
  async rateFor(providerId: string, categoryId: string, at = new Date()) {
    const schedules = await this.prisma.raw.providerFeeSchedule.findMany({
      where: {
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ categoryId }, { categoryId: null }] },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const specificity = (schedule: { providerId: string | null; categoryId: string | null }) =>
      (schedule.providerId ? 2 : 0) + (schedule.categoryId ? 1 : 0);

    const best = schedules.sort((a, b) => specificity(b) - specificity(a))[0];
    // No schedule on record is a configuration gap, not a free review — fall
    // back to the documented default rather than recording zero.
    return { amountCents: best?.amountCents ?? 100, feeScheduleId: best?.id ?? null };
  }

  /**
   * What this clinician has done, and what they are owed for it.
   *
   * Reviews and money are counted from different tables on purpose.
   * `recordForReview` swallows its own failures so an accounting problem can
   * never roll back a clinical decision that has already been signed — which
   * means an earning row can legitimately be missing. Counting decisions
   * separately from earnings is what turns that into a visible `unrecorded`
   * figure rather than money quietly absent from a total.
   */
  async summaryFor(providerId: string) {
    return runWithoutTenantScope(async () => {
      const startOfMonth = new Date();
      startOfMonth.setUTCDate(1);
      startOfMonth.setUTCHours(0, 0, 0, 0);

      const decidedWhere = {
        assignedProviderId: providerId,
        // The fee on a withdrawn visit is voided, so counting the visit here
        // would show a clinician work they are not being paid for.
        voidedAt: null,
        status: { in: ['APPROVED' as const, 'DENIED' as const] },
      };

      const [
        decided,
        approved,
        denied,
        thisMonth,
        byStatus,
        earningCount,
        firstEarning,
        credentialed,
      ] = await Promise.all([
          this.prisma.raw.prescriptionRequest.count({ where: decidedWhere }),
          this.prisma.raw.prescriptionRequest.count({
            where: { assignedProviderId: providerId, voidedAt: null, status: 'APPROVED' },
          }),
          this.prisma.raw.prescriptionRequest.count({
            where: { assignedProviderId: providerId, voidedAt: null, status: 'DENIED' },
          }),
          this.prisma.raw.prescriptionRequest.count({
            where: { ...decidedWhere, decidedAt: { gte: startOfMonth } },
          }),
          this.prisma.raw.providerEarning.groupBy({
            by: ['status'],
            where: { providerId },
            _sum: { amountCents: true },
          }),
          this.prisma.raw.providerEarning.count({ where: { providerId } }),
          this.prisma.raw.providerEarning.findFirst({
            where: { providerId },
            orderBy: { earnedAt: 'asc' },
            select: { earnedAt: true },
          }),
          this.prisma.raw.providerCategory.findMany({
            where: { providerId },
            select: { category: { select: { slug: true, name: true } } },
            orderBy: { category: { sortOrder: 'asc' } },
          }),
        ]);

      const categories = credentialed.map((row) => row.category);

      const sumOf = (status: string) =>
        byStatus.find((row) => row.status === status)?._sum.amountCents ?? 0;

      // Both are owed; the difference is whose desk the payout is sitting on.
      const awaitingApproval = sumOf('PENDING');
      const approvedForPayout = sumOf('APPROVED_FOR_PAYOUT');

      return {
        /**
         * What this clinician is credentialed to treat.
         *
         * Here rather than on its own endpoint: the queue already reads this
         * summary, and a filter that needs a second round trip before it can be
         * drawn arrives after the reader has looked away.
         */
        categories,
        work: {
          decided,
          approved,
          denied,
          thisMonth,
          // Shown so a clinician can see their own pattern. Deliberately not
          // framed as a quality score: approving less is not worse work, and a
          // rate presented as a target is a reason to approve something that
          // should be declined.
          approvalRate: decided > 0 ? Math.round((approved / decided) * 100) : null,
        },
        balance: {
          unpaidCents: awaitingApproval + approvedForPayout,
          awaitingApprovalCents: awaitingApproval,
          approvedForPayoutCents: approvedForPayout,
          paidCents: sumOf('PAID'),
          lifetimeCents: awaitingApproval + approvedForPayout + sumOf('PAID'),
          since: firstEarning?.earnedAt ?? null,
        },
        // A decided visit with no earning row against it. Should always be zero.
        unrecorded: Math.max(0, decided - earningCount),
      };
    });
  }

  /**
   * The ledger behind the balance, one row per review.
   *
   * A total nobody can take apart is a total nobody can check, so the figure on
   * the summary is always backed by the lines that produced it.
   */
  async ledgerFor(providerId: string, take = 100) {
    return runWithoutTenantScope(async () => {
      const rows = await this.prisma.raw.providerEarning.findMany({
        where: { providerId },
        orderBy: { earnedAt: 'desc' },
        take,
        include: {
          tenant: { select: { name: true } },
          request: {
            select: {
              id: true,
              externalMasterId: true,
              category: { select: { name: true } },
              patient: { select: { mrn: true } },
            },
          },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        visitId: row.request.id,
        masterId: row.request.externalMasterId,
        category: row.request.category.name,
        patientMrn: row.request.patient.mrn,
        client: row.tenant.name,
        outcome: row.outcome,
        amountCents: row.amountCents,
        status: row.status,
        earnedAt: row.earnedAt,
        paidAt: row.paidAt,
        payoutReference: row.payoutReference,
      }));
    });
  }

  /**
   * Idempotent: (`requestId`, `providerId`) is unique, so a replayed event
   * cannot double-pay. A visit shared between two credentialed clinicians pays
   * each of them once for the lines they reviewed.
   */
  async recordForReview(params: {
    requestId: string;
    providerId: string;
    tenantId: string;
    categoryId: string;
    outcome: RequestStatus;
    decidedAt: Date;
  }): Promise<void> {
    return runWithoutTenantScope(async () => {
      try {
        const existing = await this.prisma.raw.providerEarning.findUnique({
          where: {
            requestId_providerId: {
              requestId: params.requestId,
              providerId: params.providerId,
            },
          },
          select: { id: true },
        });
        if (existing) return;

        const { amountCents, feeScheduleId } = await this.rateFor(
          params.providerId,
          params.categoryId,
          params.decidedAt,
        );

        await this.prisma.raw.providerEarning.create({
          data: {
            requestId: params.requestId,
            providerId: params.providerId,
            tenantId: params.tenantId,
            amountCents,
            feeScheduleId,
            outcome: params.outcome,
            earnedAt: params.decidedAt,
            status: 'PENDING',
          },
        });
      } catch (error) {
        // An accounting failure must never roll back a clinical decision that
        // has already been made and signed.
        this.logger.error(`Failed to record earning for request ${params.requestId}`, error as Error);
      }
    });
  }
}
