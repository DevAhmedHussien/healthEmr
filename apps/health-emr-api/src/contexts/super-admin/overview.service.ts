import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';

interface ProviderWorkRow {
  providerId: string;
  reviews: bigint;
  approved: bigint;
  refused: bigint;
  owedCents: bigint;
  paidCents: bigint;
}

interface CountsRow {
  owedCents: bigint;
  paidCents: bigint;
  activePharmacies: bigint;
  totalPharmacies: bigint;
  activeProviders: bigint;
  totalProviders: bigint;
  prescriptions: bigint;
  prescriptionsThisMonth: bigint;
  adminAccounts: bigint;
  activeAdminAccounts: bigint;
  patients: bigint;
  pendingApplications: bigint;
  pendingVisits: bigint;
  stuckOrders: bigint;
}

/**
 * The Super Admin landing page.
 *
 * Every number comes from one round trip: a single SELECT of correlated
 * subqueries rather than a dozen `count()` calls. On a dashboard that loads on
 * every sign-in, the difference between one query and twelve is the difference
 * between a page that feels instant and one that does not.
 */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reviews completed and money owed, for every provider on the page. */
  private async providerWork(ids: string[]): Promise<Map<string, ProviderWorkRow>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.raw.$queryRaw<ProviderWorkRow[]>`
      SELECT
        e."providerId",
        COUNT(*)                                                          AS "reviews",
        COUNT(*) FILTER (WHERE e.outcome = 'APPROVED')                    AS "approved",
        COUNT(*) FILTER (WHERE e.outcome = 'DENIED')                      AS "refused",
        COALESCE(SUM(e."amountCents") FILTER
          (WHERE e.status IN ('PENDING','APPROVED_FOR_PAYOUT')), 0)       AS "owedCents",
        COALESCE(SUM(e."amountCents") FILTER (WHERE e.status = 'PAID'), 0) AS "paidCents"
      FROM provider_earnings e
      WHERE e."providerId" = ANY(${ids}::uuid[])
      GROUP BY e."providerId"
    `;
    return new Map(rows.map((row) => [row.providerId, row]));
  }

  async summary() {
    const [counts] = await this.prisma.raw.$queryRaw<CountsRow[]>`
      SELECT
        (SELECT COUNT(*) FROM pharmacies WHERE status = 'ACTIVE' AND "isActive")   AS "activePharmacies",
        (SELECT COUNT(*) FROM pharmacies)                                          AS "totalPharmacies",
        (SELECT COUNT(*) FROM provider_profiles WHERE status = 'ACTIVE')            AS "activeProviders",
        (SELECT COUNT(*) FROM provider_profiles)                                    AS "totalProviders",
        (SELECT COUNT(*) FROM prescriptions)                                        AS "prescriptions",
        (SELECT COUNT(*) FROM prescriptions
           WHERE "signedAt" >= date_trunc('month', now()))                          AS "prescriptionsThisMonth",
        (SELECT COUNT(*) FROM tenants)                                              AS "adminAccounts",
        (SELECT COUNT(*) FROM tenants WHERE status = 'ACTIVE')                      AS "activeAdminAccounts",
        (SELECT COUNT(*) FROM patients)                                             AS "patients",
        (SELECT
           (SELECT COUNT(*) FROM provider_applications
              WHERE status IN ('SUBMITTED','UNDER_REVIEW'))
         + (SELECT COUNT(*) FROM pharmacy_applications
              WHERE status IN ('SUBMITTED','UNDER_REVIEW')))                        AS "pendingApplications",
        (SELECT COUNT(*) FROM prescription_requests
           WHERE status IN ('ASSIGNED','IN_REVIEW','PENDING_ASSIGNMENT')
             AND "voidedAt" IS NULL)                                                AS "pendingVisits",
        -- The same rule StuckOrderService lists by, so the tile and the page it
        -- links to can never show different numbers.
        (SELECT COUNT(*) FROM pharmacy_orders
           WHERE status IN ('QUEUED','SUBMITTED')
             AND ("lastError" IS NOT NULL OR "submittedAt" IS NULL))                AS "stuckOrders",
        (SELECT COALESCE(SUM("amountCents"), 0) FROM provider_earnings
           WHERE status IN ('PENDING','APPROVED_FOR_PAYOUT'))                       AS "owedCents",
        (SELECT COALESCE(SUM("amountCents"), 0) FROM provider_earnings
           WHERE status = 'PAID')                                                   AS "paidCents"
    `;

    const [providers, pharmacies] = await Promise.all([
      this.prisma.raw.providerProfile.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { user: { lastName: 'asc' } },
        take: 50,
        select: {
          id: true, credentials: true, isAcceptingRequests: true, maxOpenRequests: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          primaryTenant: { select: { name: true } },
          licenses: {
            where: { status: 'ACTIVE' },
            select: { state: true },
            orderBy: { state: 'asc' },
          },
          categories: { select: { category: { select: { slug: true } } } },
          _count: {
            select: {
              requests: { where: { status: { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] } } },
            },
          },
        },
      }),
      this.prisma.raw.pharmacy.findMany({
        where: { status: 'ACTIVE', isActive: true },
        orderBy: { name: 'asc' },
        take: 50,
        select: {
          id: true, name: true, slug: true, platform: true,
          dispensesCompounded: true, dispensesBranded: true,
          primaryTenant: { select: { name: true } },
          catalogCategories: { where: { isActive: true }, select: { name: true } },
          _count: { select: { catalogProducts: true, tenants: true } },
        },
      }),
    ]);

    const work = await this.providerWork(providers.map((provider) => provider.id));

    return {
      counts: {
        activePharmacies: Number(counts.activePharmacies),
        totalPharmacies: Number(counts.totalPharmacies),
        activeProviders: Number(counts.activeProviders),
        totalProviders: Number(counts.totalProviders),
        prescriptions: Number(counts.prescriptions),
        prescriptionsThisMonth: Number(counts.prescriptionsThisMonth),
        adminAccounts: Number(counts.adminAccounts),
        activeAdminAccounts: Number(counts.activeAdminAccounts),
        patients: Number(counts.patients),
        pendingApplications: Number(counts.pendingApplications),
        pendingVisits: Number(counts.pendingVisits),
        stuckOrders: Number(counts.stuckOrders),
        /** What we owe providers for work already done. */
        owedCents: Number(counts.owedCents),
        paidCents: Number(counts.paidCents),
      },
      activeProviders: providers.map((provider) => {
        const stat = work.get(provider.id);
        return {
          id: provider.id,
          name: `${provider.user.firstName} ${provider.user.lastName}`,
          email: provider.user.email,
          credentials: provider.credentials,
          states: provider.licenses.map((licence) => licence.state),
          categories: provider.categories.map((link) => link.category.slug),
          assignedAdmin: provider.primaryTenant?.name ?? null,
          openRequests: provider._count.requests,
          capacity: provider.maxOpenRequests,
          accepting: provider.isAcceptingRequests,
          /** Visits decided — approvals and denials both count as work done. */
          reviews: Number(stat?.reviews ?? 0),
          approved: Number(stat?.approved ?? 0),
          refused: Number(stat?.refused ?? 0),
          /** Earned and not yet paid out. */
          owedCents: Number(stat?.owedCents ?? 0),
          paidCents: Number(stat?.paidCents ?? 0),
        };
      }),
      activePharmacies: pharmacies.map((pharmacy) => ({
        id: pharmacy.id,
        name: pharmacy.name,
        slug: pharmacy.slug,
        integrationType: pharmacy.platform,
        dispenses: [
          pharmacy.dispensesCompounded ? 'compounded' : null,
          pharmacy.dispensesBranded ? 'branded' : null,
        ].filter(Boolean) as string[],
        categories: pharmacy.catalogCategories.map((category) => category.name),
        products: pharmacy._count.catalogProducts,
        tenants: pharmacy._count.tenants,
        assignedAdmin: pharmacy.primaryTenant?.name ?? null,
      })),
    };
  }
}
