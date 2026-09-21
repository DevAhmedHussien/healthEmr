import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toSlug } from '@health-emr/types';
import type {
  PharmacyCategoryInput,
  PharmacyInput,
  PharmacyProductInput,
} from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

/**
 * The pharmacy catalogue: pharmacies, the categories each one groups its stock
 * into, and the products inside those categories.
 *
 * Note this is a *pharmacy-scoped* catalogue, distinct from the clinical
 * `Category` that drives questionnaires and provider qualification. Two
 * pharmacies routinely group the same drug differently, and forcing them into
 * one shared taxonomy makes both wrong.
 */
@Injectable()
export class PharmacyCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── pharmacies ─────────────────────────────────────────────────────────

  async listPharmacies() {
    const rows = await this.prisma.raw.pharmacy.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { catalogCategories: true, catalogProducts: true, tenants: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      platform: row.platform,
      ncpdpId: row.ncpdpId,
      dispensesCompounded: row.dispensesCompounded,
      dispensesBranded: row.dispensesBranded,
      isActive: row.isActive,
      categories: row._count.catalogCategories,
      products: row._count.catalogProducts,
      tenants: row._count.tenants,
    }));
  }

  async createPharmacy(input: PharmacyInput) {
    const clash = await this.prisma.raw.pharmacy.findUnique({ where: { slug: input.slug } });
    if (clash) throw new ConflictException(`A pharmacy already uses the slug "${input.slug}"`);

    const pharmacy = await this.prisma.raw.pharmacy.create({
      data: {
        slug: input.slug,
        name: input.name,
        platform: input.platform,
        ncpdpId: input.ncpdpId ?? null,
        dispensesCompounded: input.dispensesCompounded,
        dispensesBranded: input.dispensesBranded,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        statesServed: input.statesServed ?? [],
        isActive: input.isActive ?? true,
      },
    });

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'Pharmacy',
      entityId: pharmacy.id,
      after: { slug: pharmacy.slug, name: pharmacy.name },
    });

    return pharmacy;
  }

  async updatePharmacy(pharmacyId: string, input: Partial<PharmacyInput>) {
    const before = await this.prisma.raw.pharmacy.findUnique({ where: { id: pharmacyId } });
    if (!before) throw new NotFoundException('Pharmacy not found');

    const after = await this.prisma.raw.pharmacy.update({
      where: { id: pharmacyId },
      data: input,
    });

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'Pharmacy',
      entityId: pharmacyId,
      before: pharmacySnapshot(before),
      after: pharmacySnapshot(after),
    });

    return after;
  }

  // ── categories ─────────────────────────────────────────────────────────

  async listCategories(pharmacyId: string) {
    await this.mustExist(pharmacyId);

    return this.prisma.raw.pharmacyCategory.findMany({
      where: { pharmacyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        clinicalCategory: { select: { slug: true, name: true } },
        _count: { select: { products: true } },
      },
    });
  }

  async createCategory(pharmacyId: string, input: PharmacyCategoryInput) {
    await this.mustExist(pharmacyId);

    const slug = input.slug ?? toSlug(input.name);
    const existing = await this.prisma.raw.pharmacyCategory.findUnique({
      where: { pharmacyId_slug: { pharmacyId, slug } },
    });
    if (existing) {
      throw new ConflictException(`This pharmacy already has a category "${existing.name}"`);
    }

    const created = await this.prisma.raw.pharmacyCategory.create({
      data: {
        pharmacyId,
        name: input.name,
        slug,
        description: input.description ?? null,
        clinicalCategoryId: await this.resolveClinicalCategory(input.clinicalCategorySlug),
        defaultDaysSupply: input.defaultDaysSupply ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });

    await this.audit.record({
      action: 'PHI_CREATED',
      entityType: 'PharmacyCategory',
      entityId: created.id,
      after: categorySnapshot(created),
    });

    return created;
  }

  async updateCategory(pharmacyId: string, categoryId: string, input: Partial<PharmacyCategoryInput>) {
    const category = await this.mustOwnCategory(pharmacyId, categoryId);

    const updated = await this.prisma.raw.pharmacyCategory.update({
      where: { id: category.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.defaultDaysSupply !== undefined ? { defaultDaysSupply: input.defaultDaysSupply } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.clinicalCategorySlug !== undefined
          ? { clinicalCategoryId: await this.resolveClinicalCategory(input.clinicalCategorySlug) }
          : {}),
      },
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'PharmacyCategory',
      entityId: category.id,
      before: categorySnapshot(category),
      after: categorySnapshot(updated),
    });

    return updated;
  }

  /**
   * Deactivates a category rather than deleting it when it still holds products.
   *
   * A hard delete would cascade the products away, and a product code that has
   * appeared on a dispensed order is history — it should stop being orderable,
   * not stop having existed.
   */
  async removeCategory(pharmacyId: string, categoryId: string) {
    const category = await this.mustOwnCategory(pharmacyId, categoryId);

    const products = await this.prisma.raw.pharmacyProduct.count({
      where: { pharmacyCategoryId: category.id },
    });

    if (products > 0) {
      await this.prisma.raw.$transaction([
        this.prisma.raw.pharmacyProduct.updateMany({
          where: { pharmacyCategoryId: category.id },
          data: { isActive: false },
        }),
        this.prisma.raw.pharmacyCategory.update({
          where: { id: category.id },
          data: { isActive: false },
        }),
      ]);

      await this.audit.record({
        action: 'PHI_UPDATED',
        entityType: 'PharmacyCategory',
        entityId: category.id,
        before: categorySnapshot(category),
        after: { ...categorySnapshot(category), isActive: false, productsDeactivated: products },
      });
      return { deleted: false, deactivated: true, productsDeactivated: products };
    }

    await this.prisma.raw.pharmacyCategory.delete({ where: { id: category.id } });
    await this.audit.record({
      action: 'PHI_DELETED',
      entityType: 'PharmacyCategory',
      entityId: category.id,
      // The whole row, so a deletion in error is recoverable from the log alone.
      before: categorySnapshot(category),
    });
    return { deleted: true, deactivated: false, productsDeactivated: 0 };
  }

  // ── products ───────────────────────────────────────────────────────────

  async listProducts(pharmacyId: string, categoryId: string) {
    const category = await this.mustOwnCategory(pharmacyId, categoryId);

    return this.prisma.raw.pharmacyProduct.findMany({
      where: { pharmacyCategoryId: category.id },
      orderBy: { favouriteName: 'asc' },

    });
  }

  async createProduct(pharmacyId: string, categoryId: string, input: PharmacyProductInput) {
    const category = await this.mustOwnCategory(pharmacyId, categoryId);

    const clash = await this.prisma.raw.pharmacyProduct.findUnique({
      where: { pharmacyId_kitCode: { pharmacyId, kitCode: input.kitCode } },
    });
    if (clash) {
      throw new ConflictException(`Kit ID "${input.kitCode}" already exists at this pharmacy`);
    }


    const created = await this.prisma.raw.pharmacyProduct.create({
      data: {
        pharmacyId,
        pharmacyCategoryId: category.id,
        kitCode: input.kitCode,
        favouriteName: input.favouriteName,
        medicationName: input.medicationName,
        concentration: input.concentration ?? null,
        form: input.form,
        vialSize: input.vialSize ?? null,
        // Inherited from the category when the product does not say. Copied
        // rather than looked up at read time, so changing a category later does
        // not silently restate what a product already dispensed as.
        daysSupply: input.daysSupply ?? category.defaultDaysSupply ?? null,
        costOfGoodsCents: input.costOfGoodsCents ?? null,
        sellPriceCents: input.sellPriceCents ?? null,
        isActive: input.isActive ?? true,
      },
    });

    await this.audit.record({
      action: 'PHI_CREATED',
      entityType: 'PharmacyProduct',
      entityId: created.id,
      after: productSnapshot(created),
    });

    return created;
  }

  async updateProduct(pharmacyId: string, productId: string, input: Partial<PharmacyProductInput>) {
    const product = await this.prisma.raw.pharmacyProduct.findUnique({ where: { id: productId } });
    if (!product || product.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Product not found at this pharmacy');
    }

    const updated = await this.prisma.raw.pharmacyProduct.update({
      where: { id: productId },
      data: {
        ...(input.kitCode !== undefined ? { kitCode: input.kitCode } : {}),
        ...(input.favouriteName !== undefined ? { favouriteName: input.favouriteName } : {}),
        ...(input.medicationName !== undefined ? { medicationName: input.medicationName } : {}),
        ...(input.concentration !== undefined ? { concentration: input.concentration } : {}),
        ...(input.form !== undefined ? { form: input.form } : {}),
        ...(input.vialSize !== undefined ? { vialSize: input.vialSize } : {}),
        ...(input.daysSupply !== undefined ? { daysSupply: input.daysSupply } : {}),
        ...(input.costOfGoodsCents !== undefined ? { costOfGoodsCents: input.costOfGoodsCents } : {}),
        ...(input.sellPriceCents !== undefined ? { sellPriceCents: input.sellPriceCents } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    // Cost of goods is the number every margin figure is built from, so a change
    // to it has to be attributable to a person and a moment.
    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'PharmacyProduct',
      entityId: productId,
      before: productSnapshot(product),
      after: productSnapshot(updated),
    });

    return updated;
  }

  async removeProduct(pharmacyId: string, productId: string) {
    const product = await this.prisma.raw.pharmacyProduct.findUnique({ where: { id: productId } });
    if (!product || product.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Product not found at this pharmacy');
    }

    // Retire rather than delete if it has ever been ordered.
    const ordered = await this.prisma.raw.pharmacyOrder.count({
      where: { pharmacyId, prescription: { requestItem: { kitCode: product.kitCode } } },
    });

    if (ordered > 0) {
      await this.prisma.raw.pharmacyProduct.update({
        where: { id: productId },
        data: { isActive: false },
      });
      await this.audit.record({
        action: 'PHI_UPDATED',
        entityType: 'PharmacyProduct',
        entityId: productId,
        before: productSnapshot(product),
        after: { ...productSnapshot(product), isActive: false },
      });
      return { deleted: false, deactivated: true };
    }

    await this.prisma.raw.pharmacyProduct.delete({ where: { id: productId } });
    await this.audit.record({
      action: 'PHI_DELETED',
      entityType: 'PharmacyProduct',
      entityId: productId,
      before: productSnapshot(product),
    });
    return { deleted: true, deactivated: false };
  }


  // ── helpers ────────────────────────────────────────────────────────────

  private async mustExist(pharmacyId: string) {
    const pharmacy = await this.prisma.raw.pharmacy.findUnique({ where: { id: pharmacyId } });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    return pharmacy;
  }

  private async mustOwnCategory(pharmacyId: string, categoryId: string) {
    const category = await this.prisma.raw.pharmacyCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Category not found at this pharmacy');
    }
    return category;
  }

  private async resolveClinicalCategory(slug?: string): Promise<string | null> {
    if (!slug) return null;
    const category = await this.prisma.raw.category.findUnique({ where: { slug } });
    if (!category) throw new BadRequestException(`No clinical category with slug "${slug}"`);
    return category.id;
  }


}

/**
 * What a catalogue audit entry carries.
 *
 * Named fields rather than the whole row: the trail is kept for years, and
 * snapshotting everything would make the audit table a second copy of the
 * catalogue. These are the fields somebody would need to answer "what changed,
 * and what was it before".
 */
function pharmacySnapshot(row: {
  name: string; slug: string; contactEmail: string | null; contactPhone: string | null;
  ncpdpId: string | null; statesServed: string[]; dispensesCompounded: boolean;
  dispensesBranded: boolean; isActive: boolean;
}) {
  return {
    name: row.name, slug: row.slug, contactEmail: row.contactEmail, contactPhone: row.contactPhone,
    ncpdpId: row.ncpdpId, statesServed: row.statesServed, dispensesCompounded: row.dispensesCompounded,
    dispensesBranded: row.dispensesBranded, isActive: row.isActive,
  };
}

function categorySnapshot(row: {
  name: string; slug: string; description: string | null; sortOrder: number; isActive: boolean;
  defaultDaysSupply?: number | null;
}) {
  return {
    name: row.name, slug: row.slug, description: row.description,
    defaultDaysSupply: row.defaultDaysSupply ?? null,
    sortOrder: row.sortOrder, isActive: row.isActive,
  };
}

function productSnapshot(row: {
  kitCode: string; favouriteName: string; medicationName: string; concentration: string | null;
  form: string; vialSize: string | null; daysSupply: number | null; costOfGoodsCents: number | null;
  sellPriceCents: number | null; isActive: boolean;
}) {
  return {
    kitCode: row.kitCode, favouriteName: row.favouriteName, medicationName: row.medicationName,
    concentration: row.concentration, form: row.form, vialSize: row.vialSize,
    daysSupply: row.daysSupply, costOfGoodsCents: row.costOfGoodsCents,
    sellPriceCents: row.sellPriceCents, isActive: row.isActive,
  };
}
