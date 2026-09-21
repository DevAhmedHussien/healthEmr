import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MoneyBreakdown } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';

/** A window over which figures are reported. Absent means "everything". */
export interface Period {
  from?: Date;
  to?: Date;
}

/**
 * Everything about one client business, in a single read.
 *
 * A profile page that fires fifteen requests is a profile page that renders in
 * pieces and is impossible to reason about when it is slow. This assembles the
 * whole picture in one round trip of parallel queries, all of them bounded by
 * an index.
 *
 * On money: every figure here is labelled by where it came from. Revenue is what
 * the client told us they charged, cost is what the dispensing pharmacy said the
 * goods cost at the moment of the fill, and provider fees are what we owe for
 * the reviews. Margin is the subtraction of those three and nothing more — it is
 * not a P&L, and the coverage ratio published alongside it says how much of the
 * volume the cost figure actually saw.
 */
@Injectable()
export class TenantProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(tenantId: string, period: Period = {}) {
    const tenant = await this.prisma.raw.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true, name: true, status: true, contactEmail: true, contactPhone: true,
        ownerName: true, billingPlan: true, allowedStates: true, createdAt: true,
        archivedAt: true, archivedReason: true,
        _count: { select: { patients: true, requests: true, prescriptions: true, orders: true, users: true } },
      },
    });
    if (!tenant) throw new NotFoundException('That client account does not exist');

    const window = periodFilter(period);

    const [
      pharmacies,
      providers,
      apiKeys,
      staff,
      topMedications,
      money,
      volumeByMonth,
      recentPrescriptions,
      statusCounts,
    ] = await Promise.all([
      this.pharmacies(tenantId),
      this.providers(tenantId, window),
      this.prisma.raw.tenantApiKey.count({ where: { tenantId, revokedAt: null } }),
      this.prisma.raw.user.findMany({
        where: { tenantId },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, lastLoginAt: true },
        orderBy: { createdAt: 'asc' },
        take: 25,
      }),
      this.topMedications(tenantId, window),
      this.money(tenantId, period),
      this.volumeByMonth(tenantId),
      this.prisma.raw.prescription.findMany({
        where: { tenantId, ...(window ? { signedAt: window } : {}) },
        orderBy: { signedAt: 'desc' },
        take: 10,
        select: {
          id: true, signedAt: true, status: true, providerNameSnapshot: true,
          medication: { select: { name: true } },
          patient: { select: { firstName: true, lastName: true, mrn: true } },
        },
      }),
      this.prisma.raw.prescriptionRequest.groupBy({
        by: ['status'],
        where: { tenantId, voidedAt: null, ...(window ? { createdAt: window } : {}) },
        _count: { _all: true },
      }),
    ]);

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        ownerName: tenant.ownerName,
        billingPlan: tenant.billingPlan,
        allowedStates: tenant.allowedStates,
        createdAt: tenant.createdAt.toISOString(),
        archivedAt: tenant.archivedAt?.toISOString() ?? null,
        archivedReason: tenant.archivedReason,
      },
      counts: {
        patients: tenant._count.patients,
        visits: tenant._count.requests,
        prescriptions: tenant._count.prescriptions,
        orders: tenant._count.orders,
        staff: tenant._count.users,
        activeApiKeys: apiKeys,
      },
      pipeline: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])),
      pharmacies,
      providers,
      staff: staff.map((user) => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      })),
      topMedications,
      money,
      volumeByMonth,
      recentPrescriptions: recentPrescriptions.map((rx) => ({
        id: rx.id,
        medication: rx.medication.name,
        patient: `${rx.patient.firstName} ${rx.patient.lastName}`,
        mrn: rx.patient.mrn,
        prescriber: rx.providerNameSnapshot,
        status: rx.status,
        signedAt: rx.signedAt.toISOString(),
      })),
    };
  }

  /** Which pharmacies serve this client, and how much they have filled. */
  private async pharmacies(tenantId: string) {
    const links = await this.prisma.raw.tenantPharmacy.findMany({
      where: { tenantId },
      select: {
        isDefault: true,
        pharmacy: {
          select: {
            id: true, name: true, status: true, statesServed: true,
            dispensesCompounded: true, dispensesBranded: true, contactEmail: true,
            _count: { select: { catalogProducts: true } },
          },
        },
      },
    });
    if (!links.length) return [];

    const filled = await this.prisma.raw.pharmacyOrder.groupBy({
      by: ['pharmacyId'],
      where: { tenantId, pharmacyId: { in: links.map((link) => link.pharmacy.id) } },
      _count: { _all: true },
      _sum: { costOfGoodsCents: true },
    });
    const byPharmacy = new Map(filled.map((row) => [row.pharmacyId, row]));

    return links.map((link) => ({
      id: link.pharmacy.id,
      name: link.pharmacy.name,
      status: link.pharmacy.status,
      isDefault: link.isDefault,
      statesServed: link.pharmacy.statesServed,
      dispenses: [
        link.pharmacy.dispensesCompounded ? 'compounded' : null,
        link.pharmacy.dispensesBranded ? 'branded' : null,
      ].filter(Boolean) as string[],
      contactEmail: link.pharmacy.contactEmail,
      catalogSize: link.pharmacy._count.catalogProducts,
      orders: byPharmacy.get(link.pharmacy.id)?._count._all ?? 0,
      costOfGoodsCents: byPharmacy.get(link.pharmacy.id)?._sum.costOfGoodsCents ?? 0,
    }));
  }

  /** Which clinicians serve this client, what they reviewed, and what we owe. */
  private async providers(tenantId: string, window: Prisma.DateTimeFilter | undefined) {
    const links = await this.prisma.raw.tenantProvider.findMany({
      where: { tenantId },
      select: {
        endedAt: true,
        provider: {
          select: {
            id: true, status: true, credentials: true, isAcceptingRequests: true,
            user: { select: { firstName: true, lastName: true, email: true } },
            licenses: { where: { status: 'ACTIVE' }, select: { state: true } },
          },
        },
      },
    });
    if (!links.length) return [];

    const providerIds = links.map((link) => link.provider.id);

    const [earnings, prescriptions] = await Promise.all([
      this.prisma.raw.providerEarning.groupBy({
        by: ['providerId', 'status'],
        where: { tenantId, providerId: { in: providerIds }, ...(window ? { earnedAt: window } : {}) },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      this.prisma.raw.prescription.groupBy({
        by: ['providerId'],
        where: { tenantId, providerId: { in: providerIds }, ...(window ? { signedAt: window } : {}) },
        _count: { _all: true },
      }),
    ]);

    const signedBy = new Map(prescriptions.map((row) => [row.providerId, row._count._all]));

    return links.map((link) => {
      const mine = earnings.filter((row) => row.providerId === link.provider.id);
      const owed = mine
        .filter((row) => row.status === 'PENDING' || row.status === 'APPROVED_FOR_PAYOUT')
        .reduce((sum, row) => sum + (row._sum.amountCents ?? 0), 0);

      return {
        id: link.provider.id,
        name: `${link.provider.user.firstName} ${link.provider.user.lastName}`.trim(),
        email: link.provider.user.email,
        credentials: link.provider.credentials,
        status: link.provider.status,
        acceptingWork: link.provider.isAcceptingRequests,
        contracted: !link.endedAt,
        licensedStates: link.provider.licenses.map((licence) => licence.state).sort(),
        // Reviews, not approvals: a clinician is paid for the judgement, and
        // paying only for a yes would put a thumb on the clinical scale.
        reviews: mine.reduce((sum, row) => sum + row._count._all, 0),
        prescriptionsSigned: signedBy.get(link.provider.id) ?? 0,
        owedCents: owed,
        paidCents: mine
          .filter((row) => row.status === 'PAID')
          .reduce((sum, row) => sum + (row._sum.amountCents ?? 0), 0),
      };
    });
  }

  private async topMedications(tenantId: string, window: Prisma.DateTimeFilter | undefined) {
    const grouped = await this.prisma.raw.prescription.groupBy({
      by: ['medicationId'],
      where: { tenantId, ...(window ? { signedAt: window } : {}) },
      _count: { _all: true },
      orderBy: { _count: { medicationId: 'desc' } },
      take: 8,
    });
    if (!grouped.length) return [];

    const medications = await this.prisma.raw.medication.findMany({
      where: { id: { in: grouped.map((row) => row.medicationId) } },
      select: { id: true, name: true, strength: true, isCompounded: true },
    });
    const byId = new Map(medications.map((medication) => [medication.id, medication]));

    return grouped.map((row) => ({
      medicationId: row.medicationId,
      name: byId.get(row.medicationId)?.name ?? 'Unknown',
      strength: byId.get(row.medicationId)?.strength ?? null,
      isCompounded: byId.get(row.medicationId)?.isCompounded ?? false,
      prescriptions: row._count._all,
    }));
  }

  /**
   * Revenue, cost and fees for a client.
   *
   * Cost comes from the snapshot taken when each order was dispatched. Orders
   * placed before their pharmacy priced the product carry no snapshot; those are
   * excluded from the cost total and counted against coverage, so a low-coverage
   * margin is visibly provisional rather than quietly wrong.
   */
  async money(tenantId: string, period: Period = {}): Promise<MoneyBreakdown> {
    const window = periodFilter(period);

    const [revenue, orders, fees] = await Promise.all([
      this.prisma.raw.prescriptionRequestItem.aggregate({
        where: {
          request: { tenantId, ...(window ? { createdAt: window } : {}) },
          quotedPriceCents: { not: null },
          // Only what was actually prescribed. A line the clinician denied, or
          // has not looked at yet, is not money — counting it would inflate
          // revenue by exactly the volume we refused to fill.
          decision: { in: ['APPROVED', 'MODIFIED'] },
        },
        _sum: { quotedPriceCents: true },
      }),
      this.prisma.raw.pharmacyOrder.findMany({
        where: { tenantId, ...(window ? { createdAt: window } : {}) },
        select: { costOfGoodsCents: true },
      }),
      this.prisma.raw.providerEarning.aggregate({
        where: { tenantId, ...(window ? { earnedAt: window } : {}) },
        _sum: { amountCents: true },
      }),
    ]);

    const priced = orders.filter((order) => order.costOfGoodsCents !== null);
    const costOfGoodsCents = priced.reduce((sum, order) => sum + (order.costOfGoodsCents ?? 0), 0);
    const revenueCents = revenue._sum.quotedPriceCents ?? 0;
    const providerFeesCents = fees._sum.amountCents ?? 0;

    return {
      revenueCents,
      costOfGoodsCents,
      providerFeesCents,
      marginCents: revenueCents - costOfGoodsCents - providerFeesCents,
      costCoverage: orders.length ? priced.length / orders.length : 0,
    };
  }

  /** Twelve months of volume, for the trend line on the profile. */
  private async volumeByMonth(tenantId: string) {
    const rows = await this.prisma.raw.$queryRaw<Array<{ month: Date; prescriptions: bigint }>>`
      SELECT date_trunc('month', "signedAt") AS month, count(*)::bigint AS prescriptions
      FROM prescriptions
      WHERE "tenantId" = ${tenantId}::uuid
        AND "signedAt" >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((row) => ({
      month: row.month.toISOString().slice(0, 7),
      prescriptions: Number(row.prescriptions),
    }));
  }
}

export function periodFilter(period: Period): Prisma.DateTimeFilter | undefined {
  if (!period.from && !period.to) return undefined;
  return { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) };
}
