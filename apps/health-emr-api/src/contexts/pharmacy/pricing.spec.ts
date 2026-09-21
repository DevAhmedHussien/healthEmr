import { priceFill } from './pricing';
import type { PrismaService } from '@/shared/prisma/prisma.service';

/**
 * What a fill costs and earns, and which rule decided the price.
 *
 * The interesting cases are all about a missing number meaning something. A
 * product with no sell price is not free, a product with no cost is not costless,
 * and a client with no negotiated rate is not owed a discount — each of those
 * mistakes moves money in a direction nobody would notice from a total.
 */

const PHARMACY = 'pharmacy-1';
const TENANT = 'tenant-1';
const MEDICATION = 'medication-1';

function prismaWith(options: {
  productByKit?: Record<string, unknown> | null;
  productByMedication?: Record<string, unknown> | null;
  override?: { priceCents: number | null; isEnabled: boolean } | null;
}) {
  return {
    raw: {
      pharmacyProduct: {
        findUnique: jest.fn().mockResolvedValue(options.productByKit ?? null),
        findFirst: jest.fn().mockResolvedValue(options.productByMedication ?? null),
      },
      tenantMedication: {
        findUnique: jest.fn().mockResolvedValue(options.override ?? null),
      },
    },
  } as unknown as PrismaService;
}

const product = {
  id: 'product-1',
  costOfGoodsCents: 1_800,
  sellPriceCents: 4_500,
  isActive: true,
};

describe('priceFill', () => {
  it('takes the product price when the client has no agreed rate', async () => {
    const result = await priceFill(prismaWith({ productByKit: product }), {
      pharmacyId: PHARMACY,
      tenantId: TENANT,
      kitCode: 'FC-SEMA-25',
      medicationId: MEDICATION,
    });

    expect(result).toEqual({
      productId: 'product-1',
      costOfGoodsCents: 1_800,
      sellPriceCents: 4_500,
      sellPriceSource: 'PRODUCT',
    });
  });

  it('prefers a rate negotiated with the client', async () => {
    const result = await priceFill(
      prismaWith({ productByKit: product, override: { priceCents: 4_200, isEnabled: true } }),
      { pharmacyId: PHARMACY, tenantId: TENANT, kitCode: 'FC-SEMA-25', medicationId: MEDICATION },
    );

    expect(result.sellPriceCents).toBe(4_200);
    expect(result.sellPriceSource).toBe('TENANT_OVERRIDE');
    // The cost is still the pharmacy's — a discount to a client is ours to give,
    // not something the pharmacy absorbs.
    expect(result.costOfGoodsCents).toBe(1_800);
  });

  it('ignores a disabled override rather than treating it as a price of zero', async () => {
    const result = await priceFill(
      prismaWith({ productByKit: product, override: { priceCents: 100, isEnabled: false } }),
      { pharmacyId: PHARMACY, tenantId: TENANT, kitCode: 'FC-SEMA-25', medicationId: MEDICATION },
    );

    expect(result.sellPriceCents).toBe(4_500);
    expect(result.sellPriceSource).toBe('PRODUCT');
  });

  it('reports an unpriced product as unpriced, not as free', async () => {
    const result = await priceFill(
      prismaWith({ productByKit: { ...product, sellPriceCents: null } }),
      { pharmacyId: PHARMACY, tenantId: TENANT, kitCode: 'FC-SEMA-25', medicationId: MEDICATION },
    );

    // Null, never 0. A zero here is a real price that happens to be nothing, and
    // it would be summed into revenue as a fact rather than flagged as a gap.
    expect(result.sellPriceCents).toBeNull();
    expect(result.sellPriceSource).toBeNull();
    expect(result.costOfGoodsCents).toBe(1_800);
  });

  it('skips an inactive product and falls back to the medication', async () => {
    const result = await priceFill(
      prismaWith({
        productByKit: { ...product, isActive: false },
        productByMedication: { id: 'product-2', costOfGoodsCents: 2_000, sellPriceCents: 5_000 },
      }),
      { pharmacyId: PHARMACY, tenantId: TENANT, kitCode: 'RETIRED-KIT', medicationId: MEDICATION },
    );

    expect(result.productId).toBe('product-2');
    expect(result.sellPriceCents).toBe(5_000);
  });

  it('still charges an agreed rate when the pharmacy has no catalogue row', async () => {
    // We agreed a price with this client. Reporting nothing because the
    // catalogue is incomplete would quietly forgive the invoice.
    const result = await priceFill(
      prismaWith({ override: { priceCents: 4_200, isEnabled: true } }),
      { pharmacyId: PHARMACY, tenantId: TENANT, kitCode: null, medicationId: MEDICATION },
    );

    expect(result.sellPriceCents).toBe(4_200);
    expect(result.sellPriceSource).toBe('TENANT_OVERRIDE');
    expect(result.costOfGoodsCents).toBeNull();
    expect(result.productId).toBeNull();
  });

  it('returns nothing at all when there is neither a product nor an agreement', async () => {
    const result = await priceFill(prismaWith({}), {
      pharmacyId: PHARMACY,
      tenantId: TENANT,
      kitCode: null,
      medicationId: null,
    });

    expect(result).toEqual({
      productId: null,
      costOfGoodsCents: null,
      sellPriceCents: null,
      sellPriceSource: null,
    });
  });

  it('does not look for an override when there is no medication to key it on', async () => {
    const prisma = prismaWith({ productByKit: product });
    await priceFill(prisma, {
      pharmacyId: PHARMACY,
      tenantId: TENANT,
      kitCode: 'FC-SEMA-25',
      medicationId: null,
    });

    expect(prisma.raw.tenantMedication.findUnique).not.toHaveBeenCalled();
  });
});
