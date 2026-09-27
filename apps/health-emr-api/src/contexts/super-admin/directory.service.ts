import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListQuery } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import {
  buildOrderBy,
  listResponse,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';

export const PROVIDER_DIRECTORY_SORT = ['lastName', 'createdAt', 'npi', 'status'] as const;
export const PHARMACY_DIRECTORY_SORT = ['name', 'slug', 'createdAt', 'status'] as const;

/** Filterable columns of the provider directory, keyed by the column id. */
export const PROVIDER_DIRECTORY_FILTERS = {
  lastName: { path: 'user.lastName', kind: 'name', paths: ['user.firstName', 'user.lastName'] },
  email: { path: 'user.email', kind: 'text' },
  npi: { path: 'npi', kind: 'text' },
  states: { path: 'licenses[].state', kind: 'text' },
  // The column lists slugs; a reader may well type the full name instead.
  categories: {
    path: 'categories[].category.name',
    kind: 'name',
    paths: ['categories[].category.name', 'categories[].category.slug'],
  },
  assignedAdmin: { path: 'tenantLinks[].tenant.name', kind: 'text' },
  // `status` is deliberately absent: the endpoint already takes it as a
  // validated enum, and redeclaring it here as loose text would replace that
  // check with none.
} as const satisfies ColumnFilterMap;

/** Filterable columns of the pharmacy directory, keyed by the column id. */
export const PHARMACY_DIRECTORY_FILTERS = {
  name: { path: 'name', kind: 'text' },
  slug: { path: 'slug', kind: 'text' },
  integrationType: { path: 'platform', kind: 'exact', values: ['LIFEFILE', 'GENERIC_HTTP'] },
  assignedAdmin: { path: 'primaryTenant.name', kind: 'text' },
  categories: { path: 'catalogCategories[].name', kind: 'text' },
  medicationCount: { path: 'catalogProducts', kind: 'presence' },
  tenantCount: { path: 'tenants', kind: 'presence' },
  // `status` is deliberately absent: the endpoint already takes it as a
  // validated enum, and redeclaring it here as loose text would replace that
  // check with none.
} as const satisfies ColumnFilterMap;

interface ProviderStatRow {
  providerId: string;
  approved: bigint;
  refused: bigint;
  avgDecisionMinutes: number | null;
  earningsCents: bigint | null;
}

interface PharmacyStatRow {
  pharmacyId: string;
  ordersThisMonth: bigint;
  shipped: bigint;
  avgFulfilmentHours: number | null;
}

/**
 * The approved population, with the numbers that describe them.
 *
 * Every aggregate is computed in SQL and fetched once per page — not per row,
 * and never by pulling prescriptions into JavaScript to count them. The page
 * costs two queries regardless of page size: one for the rows, one grouped
 * aggregate covering exactly the ids on that page.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listProviders(query: ListQuery & { status?: string; state?: string; tenantId?: string }) {
    const where: Prisma.ProviderProfileWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.state ? { licenses: { some: { state: query.state, status: 'ACTIVE' } } } : {}),
      ...(query.tenantId ? { tenantLinks: { some: { tenantId: query.tenantId } } } : {}),
      ...(searchAcross(query.q, ['user.firstName', 'user.lastName', 'user.email', 'npi'])
        ? { OR: searchAcross(query.q, ['user.firstName', 'user.lastName', 'user.email', 'npi'])!.OR }
        : {}),
      ...columnFilterWhere(query, PROVIDER_DIRECTORY_FILTERS),
    };

    const sort = safeSort(query.sort, PROVIDER_DIRECTORY_SORT, 'lastName');
    const orderBy =
      sort === 'lastName'
        ? [{ user: { lastName: query.order } }, { id: query.order }]
        : buildOrderBy(sort, query.order);

    const [rows, total] = await Promise.all([
      this.prisma.raw.providerProfile.findMany({
        where,
        orderBy: orderBy as never,
        ...offsetSkipTake(query),
        select: {
          id: true, npi: true, credentials: true, status: true, createdAt: true,
          isAcceptingRequests: true, maxOpenRequests: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          primaryTenant: { select: { id: true, slug: true, name: true } },
          licenses: { select: { state: true, status: true, expiresAt: true } },
          categories: { select: { category: { select: { slug: true } } } },
        },
      }),
      this.prisma.raw.providerProfile.count({ where }),
    ]);

    const stats = await this.providerStats(rows.map((row) => row.id));

    const data = rows.map((row) => {
      const stat = stats.get(row.id);
      const approved = Number(stat?.approved ?? 0);
      const refused = Number(stat?.refused ?? 0);
      const decided = approved + refused;

      return {
        id: row.id,
        name: `${row.user.firstName} ${row.user.lastName}`,
        email: row.user.email,
        credentials: row.credentials,
        npi: row.npi,
        licensedStates: row.licenses.filter((l) => l.status === 'ACTIVE').map((l) => l.state),
        categories: row.categories.map((c) => c.category.slug),
        assignedAdmin: row.primaryTenant?.name ?? null,
        assignedAdminId: row.primaryTenant?.id ?? null,
        status: row.status,
        approved,
        refused,
        // Guarded: a provider who has decided nothing has no rate, which is
        // different from a rate of zero.
        approvalRate: decided === 0 ? null : Math.round((approved / decided) * 1000) / 10,
        avgDecisionMinutes: stat?.avgDecisionMinutes ?? null,
        earningsCents: Number(stat?.earningsCents ?? 0),
        createdAt: row.createdAt,
      };
    });

    return listResponse(data, total, query, PROVIDER_DIRECTORY_SORT);
  }

  /**
   * One grouped query for the whole page.
   *
   * `decidedAt - createdAt` needs date arithmetic Prisma's aggregate API cannot
   * express, so this is parameterised raw SQL — ids are bound, never interpolated.
   */
  private async providerStats(ids: string[]): Promise<Map<string, ProviderStatRow>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.raw.$queryRaw<ProviderStatRow[]>`
      SELECT
        r."assignedProviderId"                                            AS "providerId",
        COUNT(*) FILTER (WHERE r.status = 'APPROVED')                     AS "approved",
        COUNT(*) FILTER (WHERE r.status = 'DENIED')                       AS "refused",
        AVG(EXTRACT(EPOCH FROM (r."decidedAt" - r."createdAt")) / 60)
          FILTER (WHERE r."decidedAt" IS NOT NULL)                        AS "avgDecisionMinutes",
        (
          SELECT COALESCE(SUM(e."amountCents"), 0)
          FROM provider_earnings e
          WHERE e."providerId" = r."assignedProviderId"
        )                                                                 AS "earningsCents"
      FROM prescription_requests r
      WHERE r."assignedProviderId" = ANY(${ids}::uuid[])
      GROUP BY r."assignedProviderId"
    `;

    return new Map(
      rows.map((row) => [
        row.providerId,
        {
          ...row,
          avgDecisionMinutes:
            row.avgDecisionMinutes === null ? null : Math.round(Number(row.avgDecisionMinutes)),
        },
      ]),
    );
  }

  /**
   * One provider in full: identity, licences, qualifications, performance, the
   * documents from their application, and recent decisions.
   *
   * The documents matter — a licence scan is the evidence behind a licence row,
   * and a reviewer who cannot open it is taking the row on trust.
   */
  async getProvider(id: string) {
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true,
            avatarUrl: true, isActive: true, isEmailVerified: true, lastLoginAt: true, createdAt: true,
          },
        },
        primaryTenant: { select: { id: true, name: true, slug: true } },
        licenses: { orderBy: { state: 'asc' } },
        categories: { include: { category: { select: { slug: true, name: true } } } },
        tenantLinks: { include: { tenant: { select: { id: true, name: true, slug: true } } } },
        application: {
          include: { documents: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });

    if (!provider) return null;

    const [stats] = await Promise.all([this.providerStats([id])]);
    const stat = stats.get(id);
    const approved = Number(stat?.approved ?? 0);
    const refused = Number(stat?.refused ?? 0);
    const decided = approved + refused;

    const recent = await this.prisma.raw.prescriptionRequest.findMany({
      where: {
        voidedAt: null, assignedProviderId: id, decidedAt: { not: null } },
      orderBy: { decidedAt: 'desc' },
      take: 20,
      select: {
        id: true, externalMasterId: true, status: true, createdAt: true, decidedAt: true,
        category: { select: { slug: true } },
        tenant: { select: { name: true } },
        patient: { select: { mrn: true, firstName: true, lastName: true } },
      },
    });

    const earnings = await this.prisma.raw.providerEarning.groupBy({
      by: ['status'],
      where: { providerId: id },
      _sum: { amountCents: true },
      _count: true,
    });

    return {
      id: provider.id,
      name: `${provider.user.firstName} ${provider.user.lastName}`,
      firstName: provider.user.firstName,
      lastName: provider.user.lastName,
      email: provider.user.email,
      phone: provider.user.phone,
      avatarUrl: provider.user.avatarUrl,
      credentials: provider.credentials,
      npi: provider.npi,
      deaNumber: provider.deaNumber,
      specialties: provider.specialties,
      bio: provider.bio,
      status: provider.status,
      suspendedAt: provider.suspendedAt,
      suspendedReason: provider.suspendedReason,
      isAcceptingRequests: provider.isAcceptingRequests,
      maxOpenRequests: provider.maxOpenRequests,
      lastLoginAt: provider.user.lastLoginAt,
      joinedAt: provider.createdAt,
      assignedAdmin: provider.primaryTenant,
      contractedAdmins: provider.tenantLinks.map((link) => link.tenant),
      licenses: provider.licenses,
      categories: provider.categories.map((link) => link.category),
      performance: {
        approved,
        refused,
        approvalRate: decided === 0 ? null : Math.round((approved / decided) * 1000) / 10,
        avgDecisionMinutes: stat?.avgDecisionMinutes ?? null,
        earnings: earnings.map((row) => ({
          status: row.status,
          count: row._count,
          amountCents: row._sum.amountCents ?? 0,
        })),
      },
      applicationId: provider.application?.id ?? null,
      documents:
        provider.application?.documents.map((doc) => ({
          id: doc.id,
          kind: doc.kind,
          state: doc.state,
          fileName: doc.fileName,
          mime: doc.mime,
          size: doc.size,
          expiresAt: doc.expiresAt,
          reviewStatus: doc.reviewStatus,
          /** Authenticated stream — never a public URL. */
          url: `/api/bff/v1/super-admin/onboarding/provider/documents/${doc.id}/file`,
        })) ?? [],
      recentDecisions: recent.map((row) => ({
        id: row.id,
        masterId: row.externalMasterId,
        status: row.status,
        category: row.category.slug,
        tenant: row.tenant.name,
        patient: `${row.patient.firstName} ${row.patient.lastName}`,
        mrn: row.patient.mrn,
        submittedAt: row.createdAt,
        decidedAt: row.decidedAt,
      })),
    };
  }

  /** One pharmacy in full, including its whole catalogue and its documents. */
  async getPharmacy(id: string) {
    const pharmacy = await this.prisma.raw.pharmacy.findUnique({
      where: { id },
      include: {
        primaryTenant: { select: { id: true, name: true, slug: true } },
        config: true,
        tenants: { include: { tenant: { select: { id: true, name: true, slug: true } } } },
        catalogCategories: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            clinicalCategory: { select: { slug: true, name: true } },
            products: {
              orderBy: { favouriteName: 'asc' },
              include: { medication: { select: { medId: true, name: true, strength: true, form: true } } },
            },
          },
        },
        application: { include: { documents: { orderBy: { createdAt: 'asc' } } } },
      },
    });

    if (!pharmacy) return null;

    const stats = await this.pharmacyStats([id]);
    const stat = stats.get(id);

    const recent = await this.prisma.raw.pharmacyOrder.findMany({
      where: { pharmacyId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, status: true, createdAt: true, shippedAt: true,
        carrier: true, trackingNumber: true, costOfGoodsCents: true,
        tenant: { select: { name: true } },
        prescription: {
          select: {
            dose: true, quantity: true,
            medication: { select: { name: true } },
            patient: { select: { mrn: true } },
          },
        },
      },
    });

    const catalogue = pharmacy.catalogCategories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      clinicalCategory: category.clinicalCategory,
      isActive: category.isActive,
      products: category.products.map((product) => ({
        id: product.id,
        kitCode: product.kitCode,
        favouriteName: product.favouriteName,
        medicationName: product.medicationName,
        concentration: product.concentration,
        form: product.form,
        vialSize: product.vialSize,
        daysSupply: product.daysSupply,
        costOfGoodsCents: product.costOfGoodsCents,
        isActive: product.isActive,
        linkedMedication: product.medication,
      })),
    }));

    const allProducts = catalogue.flatMap((category) => category.products);
    const priced = allProducts.filter((product) => product.costOfGoodsCents !== null);

    return {
      id: pharmacy.id,
      name: pharmacy.name,
      slug: pharmacy.slug,
      integrationType: pharmacy.platform,
      ncpdpId: pharmacy.ncpdpId,
      /// Where this pharmacy will ship. Routing excludes it for a patient in a
      /// state that is not here, so it belongs on the screen that can change it.
      statesServed: pharmacy.statesServed,
      contactEmail: pharmacy.contactEmail,
      contactPhone: pharmacy.contactPhone,
      dispensesCompounded: pharmacy.dispensesCompounded,
      dispensesBranded: pharmacy.dispensesBranded,
      status: pharmacy.status,
      isActive: pharmacy.isActive,
      suspendedAt: pharmacy.suspendedAt,
      suspendedReason: pharmacy.suspendedReason,
      joinedAt: pharmacy.createdAt,
      assignedAdmin: pharmacy.primaryTenant,
      contractedAdmins: pharmacy.tenants.map((link) => link.tenant),
      integration: pharmacy.config
        ? {
            baseUrl: pharmacy.config.baseUrl,
            authStrategy: pharmacy.config.authStrategy,
            /** The SSM path, never the credential itself. */
            credentialRef: pharmacy.config.credentialRef,
            timeoutMs: pharmacy.config.timeoutMs,
          }
        : null,
      performance: {
        ordersThisMonth: Number(stat?.ordersThisMonth ?? 0),
        shipped: Number(stat?.shipped ?? 0),
        avgFulfilmentHours: stat?.avgFulfilmentHours ?? null,
      },
      catalogue,
      catalogueSummary: {
        categories: catalogue.length,
        products: allProducts.length,
        priced: priced.length,
        totalCostOfGoodsCents: priced.reduce((sum, p) => sum + (p.costOfGoodsCents ?? 0), 0),
        averageCostOfGoodsCents:
          priced.length === 0
            ? null
            : Math.round(priced.reduce((sum, p) => sum + (p.costOfGoodsCents ?? 0), 0) / priced.length),
      },
      applicationId: pharmacy.application?.id ?? null,
      documents:
        pharmacy.application?.documents.map((doc) => ({
          id: doc.id,
          kind: doc.kind,
          state: doc.state,
          fileName: doc.fileName,
          mime: doc.mime,
          size: doc.size,
          expiresAt: doc.expiresAt,
          reviewStatus: doc.reviewStatus,
          url: `/api/bff/v1/super-admin/onboarding/pharmacy/documents/${doc.id}/file`,
        })) ?? [],
      recentOrders: recent.map((order) => ({
        id: order.id,
        status: order.status,
        medication: order.prescription.medication.name,
        dose: order.prescription.dose,
        quantity: order.prescription.quantity,
        mrn: order.prescription.patient.mrn,
        tenant: order.tenant.name,
        costOfGoodsCents: order.costOfGoodsCents,
        carrier: order.carrier,
        trackingNumber: order.trackingNumber,
        createdAt: order.createdAt,
        shippedAt: order.shippedAt,
      })),
    };
  }

  async listPharmacies(query: ListQuery & { status?: string; tenantId?: string }) {
    const where: Prisma.PharmacyWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.tenantId ? { tenants: { some: { tenantId: query.tenantId } } } : {}),
      ...(searchAcross(query.q, ['name', 'slug', 'contactEmail', 'ncpdpId']) ?? {}),
      ...columnFilterWhere(query, PHARMACY_DIRECTORY_FILTERS),
    };

    const sort = safeSort(query.sort, PHARMACY_DIRECTORY_SORT, 'name');

    const [rows, total] = await Promise.all([
      this.prisma.raw.pharmacy.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        select: {
          id: true, slug: true, name: true, platform: true, status: true, isActive: true,
          dispensesCompounded: true, dispensesBranded: true, createdAt: true,
          primaryTenant: { select: { id: true, name: true } },
          catalogCategories: { select: { name: true }, where: { isActive: true } },
          _count: { select: { catalogProducts: true, tenants: true } },
        },
      }),
      this.prisma.raw.pharmacy.count({ where }),
    ]);

    const stats = await this.pharmacyStats(rows.map((row) => row.id));

    const data = rows.map((row) => {
      const stat = stats.get(row.id);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        integrationType: row.platform,
        assignedAdmin: row.primaryTenant?.name ?? null,
        categories: row.catalogCategories.map((c) => c.name),
        medicationCount: row._count.catalogProducts,
        tenantCount: row._count.tenants,
        ordersThisMonth: Number(stat?.ordersThisMonth ?? 0),
        avgFulfilmentHours: stat?.avgFulfilmentHours ?? null,
        status: row.status,
        createdAt: row.createdAt,
      };
    });

    return listResponse(data, total, query, PHARMACY_DIRECTORY_SORT);
  }

  private async pharmacyStats(ids: string[]): Promise<Map<string, PharmacyStatRow>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.raw.$queryRaw<PharmacyStatRow[]>`
      SELECT
        o."pharmacyId",
        COUNT(*) FILTER (WHERE o."createdAt" >= date_trunc('month', now())) AS "ordersThisMonth",
        COUNT(*) FILTER (WHERE o."shippedAt" IS NOT NULL)                   AS "shipped",
        AVG(EXTRACT(EPOCH FROM (o."shippedAt" - o."createdAt")) / 3600)
          FILTER (WHERE o."shippedAt" IS NOT NULL)                          AS "avgFulfilmentHours"
      FROM pharmacy_orders o
      WHERE o."pharmacyId" = ANY(${ids}::uuid[])
      GROUP BY o."pharmacyId"
    `;

    return new Map(
      rows.map((row) => [
        row.pharmacyId,
        {
          ...row,
          avgFulfilmentHours:
            row.avgFulfilmentHours === null
              ? null
              : Math.round(Number(row.avgFulfilmentHours) * 10) / 10,
        },
      ]),
    );
  }
}
