import { PrismaService } from '@/shared/prisma/prisma.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

export interface FillPricing {
  /** The catalogue row the figures came from. */
  productId: string | null;
  /** What this fill costs us at the pharmacy. */
  costOfGoodsCents: number | null;
  /** What we charge the client business for it. */
  sellPriceCents: number | null;
  sellPriceSource: 'PRODUCT' | 'TENANT_OVERRIDE' | null;
}

const NOTHING: FillPricing = {
  productId: null,
  costOfGoodsCents: null,
  sellPriceCents: null,
  sellPriceSource: null,
};

/**
 * What one fill costs us and earns us, resolved together.
 *
 * Together and not separately, because margin is the difference between them: a
 * cost read at dispatch and a price read at invoicing are two facts about
 * different moments, and subtracting them produces a number that was never true.
 *
 * The product is found by kit code, which is what the client ordered. Orders
 * written before kit codes were recorded fall back to the medication — without
 * that, moving an older order silently drops its cost and the margin reads as
 * unknown.
 *
 * The sell price then resolves most specific first: a rate negotiated with this
 * client, otherwise the product's own price. Same shape as the provider fee
 * schedule, for the same reason — the general case is the default, and the
 * exception is written down once.
 */
export async function priceFill(
  prisma: PrismaService,
  params: {
    pharmacyId: string;
    tenantId: string;
    kitCode: string | null;
    medicationId: string | null;
  },
): Promise<FillPricing> {
  const product = await findProduct(prisma, params);

  // The override is keyed on the medication, not the product, so a client keeps
  // their negotiated rate whichever contracted pharmacy fills the order —
  // including after a reroute, when the pharmacy changes but the deal does not.
  const override = params.medicationId
    ? await runWithoutTenantScope(() =>
        prisma.raw.tenantMedication.findUnique({
          where: {
            tenantId_medicationId: {
              tenantId: params.tenantId,
              medicationId: params.medicationId as string,
            },
          },
          select: { priceCents: true, isEnabled: true },
        }),
      )
    : null;

  const negotiated =
    override?.isEnabled && override.priceCents !== null ? override.priceCents : null;

  if (!product) {
    // No catalogue row, but a negotiated rate still stands: we agreed to charge
    // it. Reporting nothing here would quietly forgive an invoice.
    return negotiated === null
      ? NOTHING
      : { ...NOTHING, sellPriceCents: negotiated, sellPriceSource: 'TENANT_OVERRIDE' };
  }

  return {
    productId: product.id,
    costOfGoodsCents: product.costOfGoodsCents,
    sellPriceCents: negotiated ?? product.sellPriceCents,
    sellPriceSource:
      negotiated !== null ? 'TENANT_OVERRIDE' : product.sellPriceCents !== null ? 'PRODUCT' : null,
  };
}

async function findProduct(
  prisma: PrismaService,
  params: { pharmacyId: string; kitCode: string | null; medicationId: string | null },
) {
  const select = { id: true, costOfGoodsCents: true, sellPriceCents: true, isActive: true };

  if (params.kitCode) {
    const byKit = await prisma.raw.pharmacyProduct.findUnique({
      where: { pharmacyId_kitCode: { pharmacyId: params.pharmacyId, kitCode: params.kitCode } },
      select,
    });
    if (byKit?.isActive) return byKit;
  }

  if (!params.medicationId) return null;

  return prisma.raw.pharmacyProduct.findFirst({
    where: { pharmacyId: params.pharmacyId, medicationId: params.medicationId, isActive: true },
    orderBy: { updatedAt: 'desc' },
    select,
  });
}
