import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';

/**
 * What a tenant is allowed to ask for.
 *
 * Super Admin owns the global catalog; a tenant gets a subset switched on. Each
 * method here is the rule behind one of the partner API's rejection messages, so
 * the error text and the entitlement row stay in step.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** "No company found" */
  async findTenantBySlug(slug: string) {
    return this.prisma.raw.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, status: true, allowedStates: true },
    });
  }

  /** "Company does not have that visit type" */
  async resolveCategory(tenantId: string, visitType: string) {
    const link = await this.prisma.raw.tenantCategory.findFirst({
      where: {
        tenantId,
        isEnabled: true,
        category: { slug: visitType, isActive: true },
      },
      include: { category: true },
    });
    return link?.category ?? null;
  }

  /** "No match for {medId}" — resolved in bulk so one bad line names itself. */
  async resolveMedications(tenantId: string, medIds: string[]) {
    const rows = await this.prisma.raw.tenantMedication.findMany({
      where: {
        tenantId,
        isEnabled: true,
        medication: { medId: { in: medIds }, isActive: true },
      },
      include: { medication: true },
    });

    const found = new Map(rows.map((row) => [row.medication.medId, row.medication]));
    const missing = medIds.filter((id) => !found.has(id));
    return { found, missing };
  }

  /**
   * Which categories each medication may be reviewed under.
   *
   * Derived from the catalogue, never taken from the client: a partner sending
   * "weightloss" alongside an ED product would otherwise choose its own
   * reviewer. Deliberately not filtered by the tenant's enabled categories —
   * the medication itself is already entitlement-checked, and credentialing is
   * a fact about the clinician, not about what this client sells.
   */
  async categoriesForMedications(medicationIds: string[]): Promise<Map<string, string[]>> {
    if (!medicationIds.length) return new Map();

    const rows = await this.prisma.raw.categoryMedication.findMany({
      where: { medicationId: { in: medicationIds } },
      select: { medicationId: true, categoryId: true },
    });

    const byMedication = new Map<string, string[]>();
    for (const row of rows) {
      const existing = byMedication.get(row.medicationId);
      if (existing) existing.push(row.categoryId);
      else byMedication.set(row.medicationId, [row.categoryId]);
    }
    return byMedication;
  }

  /** "Pharmacy mismatch in patientPreference" */
  async resolvePharmacy(tenantId: string, pharmacySlug: string) {
    const link = await this.prisma.raw.tenantPharmacy.findFirst({
      where: {
        tenantId,
        pharmacy: { slug: pharmacySlug, isActive: true },
      },
      include: { pharmacy: true },
    });
    return link?.pharmacy ?? null;
  }

  /**
   * Which of these kit codes the pharmacy actually stocks.
   *
   * A visit names a pharmacy *and* the kits the patient chose, and the two have
   * to agree: routing an order for something the pharmacy does not carry
   * produces a prescription nobody can fill, discovered days later by a patient
   * still waiting.
   *
   * Keyed on the pharmacy's own kit code. A kit code is unique within a
   * pharmacy, and the visit already says which pharmacy, so the pair identifies
   * a product exactly — no separate catalogue of platform medications has to be
   * kept in step for an order to be placeable.
   */
  /**
   * The pharmacy's own kit code for each medication a client ordered.
   *
   * Two identifiers, not one. A client orders by `medId` — a platform-wide id
   * that means the same thing at every pharmacy — and the pharmacy fills against
   * its own kit code, which is theirs and differs between them. First Choice's
   * real catalogue lists `vywhPON4F9DCMuCdncQeGwwCwH0gfVxo` against
   * `1STCHOICE_SEMA_M_0.25_56D`; they are not the same string and never were.
   *
   * This used to match `kitCode IN (medIds)`, which worked only for as long as
   * the seed data set both to the same value. Against a real catalogue every
   * product read as not stocked.
   *
   * Returns a map so the caller can record the resolved kit code on the request —
   * that is what dispatch prices against and what the pharmacy's system expects
   * on the order.
   */
  async kitsStockedAt(pharmacyId: string, medIds: string[]): Promise<Map<string, string>> {
    if (!medIds.length) return new Map();

    const rows = await this.prisma.raw.pharmacyProduct.findMany({
      where: {
        pharmacyId,
        isActive: true,
        pharmacyCategory: { isActive: true },
        OR: [
          { medication: { medId: { in: medIds } } },
          // Catalogues written before the two identifiers were told apart, where
          // the kit code *is* the medId.
          { kitCode: { in: medIds } },
        ],
      },
      select: { kitCode: true, medication: { select: { medId: true } } },
    });

    const byMedId = new Map<string, string>();
    for (const row of rows) {
      const medId = row.medication?.medId;
      if (medId && medIds.includes(medId)) byMedId.set(medId, row.kitCode);
      else if (medIds.includes(row.kitCode)) byMedId.set(row.kitCode, row.kitCode);
    }

    return byMedId;
  }

  /** Everything a pharmacy carries, for a tenant building its order form. */
  async catalogueAt(pharmacyId: string) {
    const rows = await this.prisma.raw.pharmacyProduct.findMany({
      where: { pharmacyId, isActive: true, pharmacyCategory: { isActive: true } },
      orderBy: [{ pharmacyCategory: { sortOrder: 'asc' } }, { favouriteName: 'asc' }],
      select: {
        kitCode: true,
        favouriteName: true,
        medicationName: true,
        concentration: true,
        form: true,
        vialSize: true,
        daysSupply: true,
        defaultSig: true,
        dispenseQuantity: true,
        dispenseUnit: true,
        refills: true,
        medication: { select: { medId: true } },
        pharmacyCategory: {
          select: {
            name: true,
            slug: true,
            defaultDaysSupply: true,
            clinicalCategory: {
              select: { slug: true, followUps: { select: { slug: true, isActive: true } } },
            },
          },
        },
      },
    });

    return rows.map((row) => ({
      /**
       * What a client sends as `medId`.
       *
       * The platform id, not the pharmacy's kit code. They are different strings
       * on a real catalogue, and a client that orders by the kit code is sending
       * an identifier that means nothing outside that one pharmacy.
       */
      medId: row.medication?.medId ?? row.kitCode,
      /** The pharmacy's own code, for reconciling against their systems. */
      kitId: row.kitCode,
      name: row.medicationName,
      favouriteName: row.favouriteName,
      strength: row.concentration,
      form: row.form,
      vialSize: row.vialSize,
      daysSupply: row.daysSupply ?? row.pharmacyCategory.defaultDaysSupply,
      /** The directions this product normally ships with. */
      sig: row.defaultSig,
      dispenseQuantity: row.dispenseQuantity,
      dispenseUnit: row.dispenseUnit,
      refills: row.refills,
      category: row.pharmacyCategory.name,
      categorySlug: row.pharmacyCategory.slug,
      /**
       * The visit types this product may be ordered under.
       *
       * A pharmacy groups its stock its own way — "MIC", "Semaglutide" — which
       * says nothing about which intake form should offer it. This is the
       * clinical category behind that grouping, so an order form can show a
       * weight-loss patient weight-loss products and nothing else.
       *
       * A follow-up is included alongside its parent. Somebody on their second
       * three months of semaglutide submits `weightlossfollowup`, and a
       * follow-up that could not reorder the medication it is following up on
       * would be a form with nothing in it. Empty where the pharmacy has not
       * said what one of its groups treats.
       */
      visitTypes: visitTypesOf(row.pharmacyCategory.clinicalCategory),
    }));
  }

  /** The provider roster this tenant contracted. */
  async rosterProviderIds(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.raw.tenantProvider.findMany({
      where: { tenantId, endedAt: null },
      select: { providerId: true },
    });
    return rows.map((row) => row.providerId);
  }
}

/** A clinical category and the follow-ups that reorder from it. */
function visitTypesOf(
  category: { slug: string; followUps: { slug: string; isActive: boolean }[] } | null,
): string[] {
  if (!category) return [];
  return [category.slug, ...category.followUps.filter((row) => row.isActive).map((row) => row.slug)];
}
