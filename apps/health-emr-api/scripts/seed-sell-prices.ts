import { PrismaClient } from '@prisma/client';

/**
 * Gives every catalogue product a platform sell price, and backfills the orders
 * placed before the field existed.
 *
 * Two separate jobs, deliberately in one script because they have to agree:
 *
 * 1. Products get a sell price derived from what they cost us. A margin is a
 *    commercial decision and these are placeholders — realistic enough that the
 *    charts mean something, not a recommendation about what to charge.
 *
 * 2. Existing orders get the price their product would have had. Without this
 *    every revenue figure reads zero across all history, which is not "we earned
 *    nothing" but "we did not record it" — and a chart cannot tell you which.
 *    The backfill only ever fills a null; an order already priced is left alone,
 *    because a recorded price is a fact and this script is a guess.
 *
 * Safe to run repeatedly.
 */
const prisma = new PrismaClient();

/** Placeholder margin. Rounded to a round number, as a real price list would be. */
const MARKUP = 2.6;
const FLOOR_CENTS = 2_500;

function sellPriceFor(costOfGoodsCents: number | null): number {
  const raw = costOfGoodsCents === null ? FLOOR_CENTS : costOfGoodsCents * MARKUP;
  // To the nearest $0.50. A price list with $46.93 on it looks computed, and a
  // computed price is one nobody feels able to argue with.
  return Math.max(FLOOR_CENTS, Math.round(raw / 50) * 50);
}

async function main() {
  const products = await prisma.pharmacyProduct.findMany({
    where: { sellPriceCents: null },
    select: { id: true, kitCode: true, medicationName: true, costOfGoodsCents: true },
  });

  for (const product of products) {
    await prisma.pharmacyProduct.update({
      where: { id: product.id },
      data: { sellPriceCents: sellPriceFor(product.costOfGoodsCents) },
    });
  }

  console.log(`Priced ${products.length} products.`);

  // Backfill. Read through `costSourceProductId` rather than re-resolving by kit
  // code: that column already records which catalogue row this order was costed
  // from, and pricing it from a different row than it was costed from would
  // produce a margin that never existed.
  const orders = await prisma.pharmacyOrder.findMany({
    where: { sellPriceCents: null, costSourceProductId: { not: null } },
    select: { id: true, costSourceProductId: true },
  });

  let backfilled = 0;
  for (const order of orders) {
    const product = await prisma.pharmacyProduct.findUnique({
      where: { id: order.costSourceProductId as string },
      select: { sellPriceCents: true },
    });
    if (!product?.sellPriceCents) continue;

    await prisma.pharmacyOrder.update({
      where: { id: order.id },
      data: { sellPriceCents: product.sellPriceCents, sellPriceSource: 'PRODUCT' },
    });
    backfilled += 1;
  }

  console.log(`Backfilled ${backfilled} of ${orders.length} unpriced orders.`);

  // One negotiated rate, so the override path is exercised by the demo data
  // rather than only by its tests.
  const joey = await prisma.tenant.findFirst({ where: { slug: 'joeyMed' }, select: { id: true } });
  const semaglutide = await prisma.medication.findFirst({
    where: { name: { contains: 'Semaglutide', mode: 'insensitive' } },
    select: { id: true, name: true },
  });

  if (joey && semaglutide) {
    // Derived from what the product actually costs, not picked as a round
    // number. A flat figure looked reasonable until it landed under the cost of
    // goods on a $89 medication — a discount that loses money on every order.
    const stocked = await prisma.pharmacyProduct.findFirst({
      where: { medicationId: semaglutide.id, isActive: true, sellPriceCents: { not: null } },
      orderBy: { costOfGoodsCents: 'desc' },
      select: { costOfGoodsCents: true, sellPriceCents: true },
    });

    const standard = stocked?.sellPriceCents ?? 25_000;
    const floor = stocked?.costOfGoodsCents ?? 0;
    // 10% off, but never below what it costs us to fill.
    const agreed = Math.max(Math.round((standard * 0.9) / 50) * 50, floor + 1_000);

    await prisma.tenantMedication.upsert({
      where: { tenantId_medicationId: { tenantId: joey.id, medicationId: semaglutide.id } },
      create: { tenantId: joey.id, medicationId: semaglutide.id, isEnabled: true, priceCents: agreed },
      update: { priceCents: agreed },
    });
    console.log(
      `JoeyMed pays $${(agreed / 100).toFixed(2)} for ${semaglutide.name} by agreement ` +
        `(standard $${(standard / 100).toFixed(2)}).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
