import { PrismaClient } from '@prisma/client';

/**
 * Gives each pharmacy a priced catalogue, and the demo visits a price.
 *
 * Without this, every cost and margin figure in the console is honestly zero —
 * which is correct but makes the reporting impossible to look at. The figures
 * below are plausible wholesale costs and retail prices for the demo
 * medications, not quotes from any real pharmacy.
 *
 * Safe to run repeatedly: everything is keyed on the pharmacy's own kit code.
 */
const prisma = new PrismaClient();

interface Product {
  /**
   * The kit id is the identifier a client orders by, so it is the platform id.
   * Two identifiers that must agree is one identifier too many.
   */
  medId: string;
  favouriteName: string;
  vialSize?: string;
  daysSupply?: number;
  /** What the pharmacy charges us, in cents. */
  costOfGoodsCents: number;
  /** What the client business charges the patient, in cents. */
  retailCents: number;
}

const COMPOUNDED: Array<{ category: string; products: Product[] }> = [
  {
    category: 'Weight management',
    products: [
      { medId: 'SEMA-2.5', favouriteName: 'Sema 2.5', vialSize: '10mL', daysSupply: 28, costOfGoodsCents: 8_900, retailCents: 29_900 },
      { medId: 'SEMA-5.0', favouriteName: 'Sema 5.0', vialSize: '10mL', daysSupply: 28, costOfGoodsCents: 11_400, retailCents: 34_900 },
      { medId: 'TIRZ-10', favouriteName: 'Tirz 10', vialSize: '10mL', daysSupply: 28, costOfGoodsCents: 16_500, retailCents: 44_900 },
    ],
  },
  {
    category: 'Supportive care',
    products: [
      { medId: 'ONDAN-8', favouriteName: 'Zofran ODT', daysSupply: 10, costOfGoodsCents: 1_200, retailCents: 4_500 },
      { medId: 'NAD-100', favouriteName: 'NAD+ 100', vialSize: '5mL', daysSupply: 30, costOfGoodsCents: 7_800, retailCents: 24_900 },
    ],
  },
];

const BRANDED: Array<{ category: string; products: Product[] }> = [
  {
    category: 'Men’s health',
    products: [
      { medId: 'SILD-100', favouriteName: 'Sildenafil 100', daysSupply: 30, costOfGoodsCents: 900, retailCents: 6_900 },
      { medId: 'TADA-20', favouriteName: 'Tadalafil 20', daysSupply: 30, costOfGoodsCents: 1_100, retailCents: 7_900 },
      { medId: 'FIN-1', favouriteName: 'Fin 1mg', daysSupply: 90, costOfGoodsCents: 1_500, retailCents: 8_900 },
    ],
  },
];

async function catalogue(pharmacyName: string, groups: Array<{ category: string; products: Product[] }>) {
  const pharmacy = await prisma.pharmacy.findFirst({ where: { name: pharmacyName } });
  if (!pharmacy) {
    console.log(`  skipped ${pharmacyName} — no such pharmacy`);
    return;
  }

  for (const [index, group] of groups.entries()) {
    const slug = group.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const category = await prisma.pharmacyCategory.upsert({
      where: { pharmacyId_slug: { pharmacyId: pharmacy.id, slug } },
      create: { pharmacyId: pharmacy.id, slug, name: group.category, sortOrder: index },
      update: { name: group.category, sortOrder: index },
    });

    for (const product of group.products) {
      const medication = await prisma.medication.findUnique({ where: { medId: product.medId } });
      await prisma.pharmacyProduct.upsert({
        where: { pharmacyId_kitCode: { pharmacyId: pharmacy.id, kitCode: product.medId } },
        create: {
          pharmacyId: pharmacy.id,
          pharmacyCategoryId: category.id,
          kitCode: product.medId,
          favouriteName: product.favouriteName,
          medicationName: medication?.name ?? product.favouriteName,
          concentration: medication?.strength ?? null,
          form: medication?.form ?? 'OTHER',
          vialSize: product.vialSize ?? null,
          daysSupply: product.daysSupply ?? null,
          costOfGoodsCents: product.costOfGoodsCents,
          medicationId: medication?.id ?? null,
        },
        update: { costOfGoodsCents: product.costOfGoodsCents, medicationId: medication?.id ?? null },
      });
    }
  }
  console.log(`  ${pharmacyName}: ${groups.reduce((sum, g) => sum + g.products.length, 0)} products priced`);
}

async function main() {
  console.log('catalogues');
  await catalogue('First Choice Pharmacy', COMPOUNDED);
  await catalogue('Apex Compounding Pharmacy', COMPOUNDED);
  await catalogue('Retail Partner Pharmacy', BRANDED);

  // What the client business charged. Normally this arrives on the intake
  // payload; the demo partner sends none, so the analytics have nothing to
  // divide against without it.
  const retail = new Map<string, number>(
    [...COMPOUNDED, ...BRANDED].flatMap((g) => g.products.map((p) => [p.medId, p.retailCents] as const)),
  );

  const items = await prisma.prescriptionRequestItem.findMany({
    where: { quotedPriceCents: null },
    select: { id: true, medication: { select: { medId: true } } },
  });
  let priced = 0;
  for (const item of items) {
    const price = retail.get(item.medication.medId);
    if (!price) continue;
    await prisma.prescriptionRequestItem.update({ where: { id: item.id }, data: { quotedPriceCents: price } });
    priced += 1;
  }
  console.log(`quoted prices: ${priced} of ${items.length} unpriced lines`);

  // Orders dispatched before the snapshot existed carry no cost. Fill them from
  // today's catalogue — a demo-only approximation, and the reason the console
  // reports coverage rather than presenting cost as exact.
  const orders = await prisma.pharmacyOrder.findMany({
    where: { costOfGoodsCents: null },
    select: { id: true, pharmacyId: true, prescription: { select: { medicationId: true } } },
  });
  let filled = 0;
  for (const order of orders) {
    const product = await prisma.pharmacyProduct.findFirst({
      where: { pharmacyId: order.pharmacyId, medicationId: order.prescription.medicationId, isActive: true },
      select: { id: true, costOfGoodsCents: true },
    });
    if (!product?.costOfGoodsCents) continue;
    await prisma.pharmacyOrder.update({
      where: { id: order.id },
      data: { costOfGoodsCents: product.costOfGoodsCents, costSourceProductId: product.id },
    });
    filled += 1;
  }
  console.log(`order cost snapshots: ${filled} of ${orders.length} backfilled`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
