import { createHash } from 'node:crypto';
import { PrismaClient, type MedicationForm } from '@prisma/client';

/**
 * Hallandale Pharmacy — a second LifeFile pharmacy.
 *
 * The point of this script is to prove the platform takes a second LifeFile
 * pharmacy without a line of new code: the same `LifeFileService` builds the
 * order, and everything that differs comes from this pharmacy's own config row.
 *
 * Two things here are deliberately NOT real, and the script says so when it
 * finishes:
 *
 *  - **The medIds and kit codes are generated.** First Choice's were transcribed
 *    from the pharmacy's own product list, because those identifiers are what a
 *    client sends on `patientPreference[].medId` and what the pharmacy fills
 *    against. Inventing one that *looks* real is how an order gets rejected, or
 *    filled as the wrong product. These are derived from the product name so
 *    they are stable across runs, and they must be replaced with Hallandale's
 *    real catalogue before anybody orders against them.
 *  - **The integration is switched off** and its credentials are placeholders.
 *    Nothing transmits until a person puts the real values in from the console.
 *
 * Cost and sell prices are placeholders too, on the same footing as the rest of
 * the catalogue.
 *
 * Safe to run repeatedly: everything is keyed on medId or kit code.
 */
const prisma = new PrismaClient();

interface Product {
  favouriteName: string;
  medication: string;
  strength: string;
  form: MedicationForm;
  sig: string;
  quantity: string;
  dispenseUnit: string;
  refills: number;
  days: number;
  /** Hallandale's own shelf grouping, which is not our clinical category. */
  pharmacyCategory: string;
  /** The clinical category a visit of this type belongs to. */
  visitType: string;
  costCents: number;
}

const CATALOGUE: Product[] = [
  // ── weight loss ───────────────────────────────────────────────────────
  {
    favouriteName: 'Hallandale Semaglutide 2.5mg/mL (1 month)',
    medication: 'Semaglutide 2.5mg/mL - 2mL',
    strength: '2.5 MG/ML',
    form: 'INJECTABLE',
    sig: 'Inject 0.25mg subcutaneously once weekly for 4 weeks.',
    quantity: '2',
    dispenseUnit: 'milliliter',
    refills: 0,
    days: 30,
    pharmacyCategory: 'GLP-1',
    visitType: 'weightloss',
    costCents: 9500,
  },
  {
    favouriteName: 'Hallandale Tirzepatide 10mg/mL (1 month)',
    medication: 'Tirzepatide 10mg/mL - 2mL',
    strength: '10 MG/ML',
    form: 'INJECTABLE',
    sig: 'Inject 2.5mg subcutaneously once weekly for 4 weeks.',
    quantity: '2',
    dispenseUnit: 'milliliter',
    refills: 0,
    days: 30,
    pharmacyCategory: 'GLP-1',
    visitType: 'weightloss',
    costCents: 16500,
  },
  {
    favouriteName: 'Hallandale Lipo-C (MIC + B12) 10mL',
    medication: 'Lipo-C MIC/B12 25/50/50/1mg/mL - 10mL',
    strength: '25/50/50/1 MG/ML',
    form: 'INJECTABLE',
    sig: 'Inject 1mL intramuscularly once weekly.',
    quantity: '10',
    dispenseUnit: 'milliliter',
    refills: 1,
    days: 60,
    pharmacyCategory: 'Lipotropics',
    visitType: 'weightloss',
    costCents: 4200,
  },

  // ── sexual health ─────────────────────────────────────────────────────
  {
    favouriteName: 'Hallandale Sildenafil/Tadalafil Troche 60/20mg',
    medication: 'Sildenafil/Tadalafil Troche 60/20mg',
    strength: '60/20 MG',
    form: 'ORAL',
    sig: 'Dissolve one troche under the tongue 30 minutes before activity. Not more than one in 24 hours.',
    quantity: '12',
    dispenseUnit: 'troche',
    refills: 2,
    days: 90,
    pharmacyCategory: 'Sexual Health',
    visitType: 'ED',
    costCents: 3800,
  },

  // ── hair loss ─────────────────────────────────────────────────────────
  {
    favouriteName: 'Hallandale Minoxidil/Finasteride Topical 6/0.1%',
    medication: 'Minoxidil/Finasteride Topical Solution 6%/0.1% - 60mL',
    strength: '6%/0.1%',
    form: 'TOPICAL',
    sig: 'Apply 1mL to the scalp once daily.',
    quantity: '60',
    dispenseUnit: 'milliliter',
    refills: 2,
    days: 90,
    pharmacyCategory: 'Hair',
    visitType: 'hairloss',
    costCents: 4500,
  },

  // ── hormones ──────────────────────────────────────────────────────────
  {
    favouriteName: 'Hallandale Testosterone Cypionate 200mg/mL (10mL)',
    medication: 'Testosterone Cypionate 200mg/mL - 10mL',
    strength: '200 MG/ML',
    form: 'INJECTABLE',
    sig: 'Inject 0.5mL intramuscularly once weekly.',
    quantity: '10',
    dispenseUnit: 'milliliter',
    refills: 1,
    days: 90,
    pharmacyCategory: 'Hormones',
    visitType: 'hormones',
    costCents: 7200,
  },

  // ── anti-aging ────────────────────────────────────────────────────────
  {
    favouriteName: 'Hallandale NAD+ 200mg/mL (10mL)',
    medication: 'NAD+ 200mg/mL - 10mL',
    strength: '200 MG/ML',
    form: 'INJECTABLE',
    sig: 'Inject 0.5mL subcutaneously twice weekly.',
    quantity: '10',
    dispenseUnit: 'milliliter',
    refills: 0,
    days: 30,
    pharmacyCategory: 'Longevity',
    visitType: 'antiAging',
    costCents: 11000,
  },

  // ── menopause ─────────────────────────────────────────────────────────
  {
    favouriteName: 'Hallandale Estradiol/Progesterone Cream',
    medication: 'Estradiol/Progesterone Cream 0.5/50mg per mL - 30mL',
    strength: '0.5/50 MG/ML',
    form: 'TOPICAL',
    sig: 'Apply 1mL to the inner forearm once nightly.',
    quantity: '30',
    dispenseUnit: 'milliliter',
    refills: 2,
    days: 90,
    pharmacyCategory: 'Hormones',
    visitType: 'menopause',
    costCents: 5400,
  },
];

/**
 * A stable, obviously-Hallandale identifier.
 *
 * Derived from the product name so re-running the script does not mint a second
 * copy of everything, and prefixed so nobody mistakes one of these for a real
 * catalogue id handed over by the pharmacy.
 */
function placeholderMedId(name: string): string {
  return `hal${createHash('sha256').update(name).digest('base64url').slice(0, 29)}`;
}

function kitCodeFor(product: Product): string {
  const slug = product.favouriteName
    .replace(/^Hallandale /, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return `HALLANDALE_${slug}`;
}

/** Placeholder, on the same footing as the rest of the catalogue's pricing. */
const MARKUP = 2.6;

async function main() {
  const pharmacy = await prisma.pharmacy.upsert({
    where: { slug: 'hallandale' },
    create: {
      slug: 'hallandale',
      name: 'Hallandale Pharmacy',
      platform: 'LIFEFILE',
      // A compounding pharmacy: it makes the preparation rather than
      // dispensing a manufacturer's pack.
      dispensesCompounded: true,
      dispensesBranded: false,
      config: {
        create: {
          /**
           * Placeholders, and the integration is off.
           *
           * The real base URL, vendor, location, API network and practice ids
           * come from the pharmacy at activation, and the credentials are
           * sealed through the console rather than written here — this file is
           * in version control.
           */
          baseUrl: 'https://placeholder.invalid/lfapi/v1',
          authStrategy: 'BEARER',
          credentialRef: 'hallandale',
          vendorId: null,
          locationId: null,
          apiNetworkId: null,
          practiceId: null,
          defaultShippingService: null,
          timeoutMs: 20000,
          isEnabled: false,
        },
      },
    },
    update: {},
    select: { id: true, name: true },
  });

  // Their clinical categories, keyed by the visit type a patient submits under.
  const categoryBySlug = new Map<string, string>();
  for (const slug of new Set(CATALOGUE.map((row) => row.visitType))) {
    const category = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (!category) {
      console.warn(`  ! no clinical category "${slug}" — its products will be skipped`);
      continue;
    }
    categoryBySlug.set(slug, category.id);
  }

  // The pharmacy groups its stock its own way; that grouping becomes the
  // pharmacy category, and the visit type stays the clinical link.
  const pharmacyCategoryIds = new Map<string, string>();
  for (const row of CATALOGUE) {
    if (pharmacyCategoryIds.has(row.pharmacyCategory)) continue;

    const slug = row.pharmacyCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await prisma.pharmacyCategory.findFirst({
      where: { pharmacyId: pharmacy.id, slug },
      select: { id: true },
    });

    const category =
      existing ??
      (await prisma.pharmacyCategory.create({
        data: {
          pharmacyId: pharmacy.id,
          name: row.pharmacyCategory,
          slug,
          clinicalCategoryId: categoryBySlug.get(row.visitType) ?? null,
          defaultDaysSupply: row.days,
          isActive: true,
        },
        select: { id: true },
      }));

    pharmacyCategoryIds.set(row.pharmacyCategory, category.id);
  }

  let products = 0;

  for (const row of CATALOGUE) {
    const clinicalCategoryId = categoryBySlug.get(row.visitType);
    if (!clinicalCategoryId) continue;

    const medId = placeholderMedId(row.favouriteName);
    const kitCode = kitCodeFor(row);

    const medication = await prisma.medication.upsert({
      where: { medId },
      create: {
        medId,
        name: row.medication,
        strength: row.strength,
        form: row.form,
        isCompounded: true,
        isBranded: false,
        isControlled: false,
        isActive: true,
      },
      update: { name: row.medication, strength: row.strength, form: row.form },
      select: { id: true },
    });

    // Which clinical categories may review it. This is what routing reads to
    // decide who is credentialed for the line.
    await prisma.categoryMedication.upsert({
      where: {
        categoryId_medicationId: { categoryId: clinicalCategoryId, medicationId: medication.id },
      },
      create: { categoryId: clinicalCategoryId, medicationId: medication.id },
      update: {},
    });

    const existing = await prisma.pharmacyProduct.findFirst({
      where: { pharmacyId: pharmacy.id, kitCode },
      select: { id: true },
    });

    const data = {
      pharmacyId: pharmacy.id,
      pharmacyCategoryId: pharmacyCategoryIds.get(row.pharmacyCategory)!,
      medicationId: medication.id,
      kitCode,
      favouriteName: row.favouriteName,
      medicationName: row.medication,
      concentration: row.strength,
      form: row.form,
      daysSupply: row.days,
      defaultSig: row.sig,
      dispenseQuantity: row.quantity,
      dispenseUnit: row.dispenseUnit,
      refills: row.refills,
      costOfGoodsCents: row.costCents,
      sellPriceCents: Math.round((row.costCents * MARKUP) / 100) * 100,
      isActive: true,
    };

    if (existing) {
      await prisma.pharmacyProduct.update({ where: { id: existing.id }, data });
    } else {
      await prisma.pharmacyProduct.create({ data });
      products += 1;
    }
  }

  // Entitle the client businesses that already order compounded products, so
  // the catalogue is reachable from an intake rather than sitting unused.
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  const medications = await prisma.pharmacyProduct.findMany({
    where: { pharmacyId: pharmacy.id },
    select: { medicationId: true },
  });

  for (const tenant of tenants) {
    await prisma.tenantPharmacy.upsert({
      where: { tenantId_pharmacyId: { tenantId: tenant.id, pharmacyId: pharmacy.id } },
      create: { tenantId: tenant.id, pharmacyId: pharmacy.id },
      update: {},
    });

    for (const { medicationId } of medications) {
      if (!medicationId) continue;
      await prisma.tenantMedication.upsert({
        where: { tenantId_medicationId: { tenantId: tenant.id, medicationId } },
        create: { tenantId: tenant.id, medicationId, isEnabled: true },
        update: {},
      });
    }
  }

  console.log(`\n${pharmacy.name}`);
  console.log(`  ${products} product(s) added, ${CATALOGUE.length} in the catalogue`);
  console.log(`  ${pharmacyCategoryIds.size} shelf categories across ${categoryBySlug.size} clinical categories`);
  console.log(`  entitled to ${tenants.length} client account(s)`);
  console.log('\n  Two things here are placeholders:');
  console.log('   - medIds and kit codes are generated, not Hallandale\'s own. Replace them');
  console.log('     with the pharmacy\'s real catalogue before anybody orders against them.');
  console.log('   - the LifeFile integration is SWITCHED OFF with no credentials. Set the');
  console.log('     base URL, vendor/location/network/practice ids and login from');
  console.log('     Super Admin → Pharmacies → Hallandale → Pharmacy integration.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
