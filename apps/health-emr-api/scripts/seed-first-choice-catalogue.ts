import { PrismaClient, type MedicationForm } from '@prisma/client';
import { ADDITIONS } from './catalogue-additions';

/**
 * First Choice's real catalogue.
 *
 * Transcribed from the pharmacy's own product list, so the medIds below are the
 * identifiers a client business actually sends on `patientPreference[].medId`
 * and the kit codes are what First Choice's system expects on an order. Neither
 * is ours to invent — getting one character wrong is an order the pharmacy
 * rejects, or worse, fills as something else.
 *
 * Cost and sell price are *not* from the pharmacy's list, which carries neither.
 * They are placeholders derived below, and the script says so on the way out.
 *
 * Safe to run repeatedly: everything is keyed on the kit code.
 */
const prisma = new PrismaClient();

export interface Row {
  favouriteName: string;
  medId: string;
  medication: string;
  type: 'compound' | 'med';
  strength?: string;
  sig: string;
  quantity: string;
  dispense: string;
  refills: number;
  days: number;
  /** The pharmacy's own grouping, which is not our clinical category. */
  pharmacyCategory?: string;
  notes: string;
  /** The clinical category a visit of this type belongs to. */
  visitType: string;
  /** Extracted from the notes, where First Choice writes it. */
  kitCode: string;
  /**
   * How it is given, where the dispense unit would get it wrong.
   *
   * Millilitres usually mean an injection, but a topical solution is also
   * dispensed in millilitres — and a product filed as INJECTABLE is one a
   * clinician is asked where to inject. Set this whenever the unit lies.
   */
  form?: MedicationForm;
}

export const CATALOGUE: Row[] = [
  {
    favouriteName: '1stChoice MIC+B12 (3 month)',
    medId: 'hlxROjepHao7PuolVL2WUwoX1Kf8Z8DK',
    medication: 'MIC+B12 25/100/50/1mg/mL - 10mL',
    type: 'compound',
    sig: 'INJECT 0.8ML (80 UNITS) SUBCUTANEOUSLY ONCE WEEKLY',
    quantity: '10',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'MIC',
    notes: 'No commercially available option.',
    visitType: 'antiAging',
    kitCode: '1STCHOICE_MIC_S_20_90D',
  },
  {
    favouriteName: '1stChoice NAD+ 1000mg vial (3 month)',
    medId: '1HdMO2kZU9RPJeDvo1hxsUKNbiP3EijS',
    medication: 'NAD+ 200mg/mL - 5mL',
    type: 'compound',
    sig:
      'INJECT 0.1ML (10 UNITS) SUBCUTANEOUSLY TWICE WEEKLY FOR 2 WEEKS, THEN INJECT 0.15ML (15 UNITS) ' +
      'SUBCUTANEOUSLY TWICE WEEKLY FOR 2 WEEKS, THEN INJECT 0.25ML (25 UNITS) SUBCUTANEOUSLY TWICE ' +
      'WEEKLY THEREAFTER THROUGH WEEK 12. KEEP IN REFRIGERATOR',
    quantity: '5',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    notes: 'No commercially available option.',
    visitType: 'antiAging',
    kitCode: '1STCHOICE_NAD_INJ_S_20_90D',
  },
  {
    favouriteName: '1stChoice Ondansetron 8mg ODT',
    medId: 'XenCTJr0kx2f0qaoNkGika1cNbxvcnan',
    medication: 'Ondansetron Oral Tablet Disintegrating',
    type: 'med',
    strength: '8 MG',
    sig: 'TAKE 1 TABLET BY MOUTH AS NEEDED NAUSEA',
    quantity: '30',
    dispense: 'tablet',
    refills: 0,
    days: 30,
    pharmacyCategory: 'antiNausea',
    notes: '',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_ONDAN_S_8_PKG',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.25mg (2 month)',
    medId: 'vywhPON4F9DCMuCdncQeGwwCwH0gfVxo',
    medication: 'Semaglutide 2.5mg/mL - 1mL',
    type: 'compound',
    sig: 'Inject 10 units (0.25mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '1',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss1',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_0.25_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.25mg (3 month)',
    medId: 'UeOYUPNQWdSw04Dkc0iBg7YdJp6KodnD',
    medication: 'Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig: 'Inject 10 units (0.25mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '2',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Weightloss1',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_0.25_90D',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.25mg/0.5mg (2 month)',
    medId: 'EfGOipA7A3DmEiBnw5Hao1g1O5tZaVuP',
    medication: 'Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig:
      'Wks 1-4: Inject 10 units (0.25mg) SubQ once weekly. Wks 5-8: Inject 20 units (0.5mg) SubQ ' +
      'once weekly. Titrate as tolerated. Concentration: 2.5mg/mL',
    quantity: '2',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss1',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_T_0.25to0.5_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.5mg (2 month)',
    medId: 'ycC1JDL0oLFvtjZhCm0ddKLN3j07x3Sy',
    medication: 'Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig: 'Inject 20 units (0.5mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '2',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss2',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_0.5_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.5mg (3 month)',
    medId: 'koK86IM5kb6ABRF9bUZ9Hh0KUY4ZUxS9',
    medication: 'Semaglutide 2.5mg/mL - 3mL',
    type: 'compound',
    sig: 'Inject 20 units (0.5mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '3',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Weightloss2',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_0.5_90D',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.5mg/1mg (2 month)',
    medId: 'aJoL4bIiODosN6o7WOrXjhercy46q5C0',
    medication: 'Semaglutide 2.5mg/mL - 3mL',
    type: 'compound',
    sig:
      'Wks 1-4: Inject 20 units (0.5mg) SubQ once weekly. Wks 5-8: Inject 40 units (1mg) SubQ once ' +
      'weekly. Titrate as tolerated. Concentration: 2.5mg/mL',
    quantity: '3',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss2',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_T_0.5to1_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 0.5mg/1mg/1.7mg (3 month)',
    medId: 'qaIL749jwrM12rVfmaTs7pb1SJvmyZr3',
    medication: 'Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig:
      'Wks 1-4: Inject 20 units (0.5mg) SubQ once weekly. Wks 5-8: Inject 40 units (1mg) SubQ once ' +
      'weekly. Wks 9-12: Inject 68 units (1.7mg) SubQ once weekly. Titrate as tolerated. ' +
      'Concentration: 2.5mg/mL',
    quantity: '6',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Weightloss2',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_T_0.5to1.7_90D',
  },
  {
    favouriteName: '1stChoice Semaglutide 1mg (2 month)',
    medId: '2xPDWQrhKDFqfNSIIydEgaoovQjVXQcb',
    medication: 'Semaglutide 2.5mg/mL - 4mL',
    type: 'compound',
    sig: 'Inject 40 units (1mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '4',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss3',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_1_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 1.7mg',
    medId: 'yUUGpj8fL1pHBPZhrXa8dlr3rM49SqAC',
    medication: 'Semaglutide 2.5mg/mL - 3mL',
    type: 'compound',
    sig: 'Inject 68 units (1.7mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '3',
    dispense: 'milliliter',
    refills: 0,
    days: 30,
    pharmacyCategory: 'Weightloss4',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_1.7_30D',
  },
  {
    favouriteName: '1stChoice Semaglutide 1.7mg (2 month)',
    medId: 'aCQfAUd9FUUguAQv3goWz7VuPPpNNfJd',
    medication: 'Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig: 'Inject 68 units (1.7mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '6',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss4',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_1.7_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 1.7mg (3 month)',
    medId: 'MDSEgl7YcMVQ3Z67x55aY1KvvpVhDswo',
    medication:
      'Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 1mL',
    type: 'compound',
    sig: 'Inject 68 units (1.7mg) SubQ once weekly. Maintain dose. Concentration: 2.5mg/mL',
    quantity: '9',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Weightloss4',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_M_1.7_90D',
  },
  {
    favouriteName: '1stChoice Semaglutide 1.7mg/2mg (2 month)',
    medId: 'GUKadbq47wEhayUYhfhe9ssu0N1qIG1A',
    medication: 'Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig:
      'Wks 1-4: Inject 68 units (1.7mg) SubQ once weekly. Wks 5-8: Inject 80 units (2mg) SubQ once ' +
      'weekly. Titrate as tolerated. Concentration: 2.5mg/mL',
    quantity: '6',
    dispense: 'milliliter',
    refills: 0,
    days: 60,
    pharmacyCategory: 'Weightloss4',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_T_1.7to2_56D',
  },
  {
    favouriteName: '1stChoice Semaglutide 1.7mg/2mg/2.4mg (3 month)',
    medId: 'e8qsVIHENkKrPyWhNLrgtBwpISkqcBlb',
    medication:
      'Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 4mL AND Semaglutide 2.5mg/mL - 2mL',
    type: 'compound',
    sig:
      'Wks 1-4: Inject 68 units (1.7mg) SubQ once weekly. Wks 5-8: Inject 80 units (2mg) SubQ once ' +
      'weekly. Wks 9-12: Inject 96 units (2.4mg) SubQ once weekly. Titrate as tolerated. ' +
      'Concentration: 2.5mg/mL',
    quantity: '10',
    dispense: 'milliliter',
    refills: 0,
    days: 90,
    pharmacyCategory: 'Weightloss4',
    notes: 'Alt dosing for pt need or to decrease side effects.',
    visitType: 'weightloss',
    kitCode: '1STCHOICE_SEMA_T_1.7to2.4_90D',
  },
];

/** The pharmacy's own account id at LifeFile, as it appears on their list. */
const PHARMACY_ACCOUNT_ID = '8817';

/**
 * Everything First Choice carries: their own list, plus the sexual health, hair
 * loss and wellness products whose identifiers we generated pending theirs.
 * Seeded and reconciled as one catalogue — the provenance difference is
 * recorded in `catalogue-additions.ts`, not in how the rows are treated.
 */
export const ALL_PRODUCTS: Row[] = [...CATALOGUE, ...ADDITIONS];

/**
 * Placeholder economics.
 *
 * The pharmacy's list carries no prices, so these are invented from the size of
 * the fill and are not quotes from anybody. Set the real ones in the console.
 */
function placeholderCostCents(row: Row): number {
  const units = Number(row.quantity) || 1;
  const perUnit = row.type === 'compound' ? 1_900 : 120;
  return Math.max(1_500, Math.round((units * perUnit) / 50) * 50);
}

/**
 * How a product is given.
 *
 * The dispense unit is the best available signal — the pharmacy's `type` only
 * says compounded or not — but it is a signal, not the answer, so a row that
 * knows better overrides it.
 */
function formOf(row: Row): MedicationForm {
  if (row.form) return row.form;
  if (row.dispense === 'tablet' || row.dispense === 'capsule' || row.dispense === 'troche') {
    return 'ORAL';
  }
  if (row.dispense === 'milliliter') return 'INJECTABLE';
  return 'OTHER';
}

async function main() {
  const pharmacy = await prisma.pharmacy.findFirst({
    where: { slug: 'first-choice' },
    select: { id: true, name: true },
  });

  if (!pharmacy) {
    throw new Error('First Choice is not in this database. Run the main seed first.');
  }

  // Their clinical categories, keyed by the visit type a patient submits under.
  const visitTypes = [...new Set(ALL_PRODUCTS.map((row) => row.visitType))];
  const categoryBySlug = new Map<string, string>();

  for (const slug of visitTypes) {
    const category = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (!category) {
      console.warn(`  ! no clinical category "${slug}" — products for it will be skipped`);
      continue;
    }
    categoryBySlug.set(slug, category.id);
  }

  // The pharmacy groups its own stock differently from how we group visits, so
  // its groupings become the pharmacy categories and the visit type stays the
  // clinical link.
  const pharmacyCategoryIds = new Map<string, string>();

  for (const row of ALL_PRODUCTS) {
    const groupName = row.pharmacyCategory ?? titleCase(row.visitType);
    if (pharmacyCategoryIds.has(groupName)) continue;

    const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await prisma.pharmacyCategory.findFirst({
      where: { pharmacyId: pharmacy.id, slug },
      select: { id: true },
    });

    const category =
      existing ??
      (await prisma.pharmacyCategory.create({
        data: {
          pharmacyId: pharmacy.id,
          name: groupName,
          slug,
          clinicalCategoryId: categoryBySlug.get(row.visitType) ?? null,
          defaultDaysSupply: row.days,
          isActive: true,
        },
        select: { id: true },
      }));

    pharmacyCategoryIds.set(groupName, category.id);
  }

  let created = 0;
  let updated = 0;

  for (const row of ALL_PRODUCTS) {
    // The platform medication a client orders by. `medId` is the pharmacy's own
    // identifier and is what arrives on an intake, so it is the key.
    const medication = await prisma.medication.upsert({
      where: { medId: row.medId },
      create: {
        medId: row.medId,
        name: row.medication,
        strength: row.strength ?? null,
        form: formOf(row),
        isCompounded: row.type === 'compound',
        isBranded: false,
        isActive: true,
      },
      update: { name: row.medication, strength: row.strength ?? null, form: formOf(row) },
      select: { id: true },
    });

    const clinicalId = categoryBySlug.get(row.visitType);
    if (clinicalId) {
      await prisma.categoryMedication.upsert({
        where: { categoryId_medicationId: { categoryId: clinicalId, medicationId: medication.id } },
        create: { categoryId: clinicalId, medicationId: medication.id },
        update: {},
      });
    }

    const groupName = row.pharmacyCategory ?? titleCase(row.visitType);
    const pharmacyCategoryId = pharmacyCategoryIds.get(groupName);
    if (!pharmacyCategoryId) continue;

    const existing = await prisma.pharmacyProduct.findUnique({
      where: { pharmacyId_kitCode: { pharmacyId: pharmacy.id, kitCode: row.kitCode } },
      select: { id: true, costOfGoodsCents: true, sellPriceCents: true },
    });

    const data = {
      pharmacyCategoryId,
      favouriteName: row.favouriteName,
      medicationName: row.medication,
      concentration: row.strength ?? null,
      form: formOf(row),
      vialSize: `${row.quantity} ${row.dispense}`,
      daysSupply: row.days,
      defaultSig: row.sig,
      dispenseQuantity: row.quantity,
      dispenseUnit: row.dispense,
      refills: row.refills,
      pharmacyNotes: [row.notes, `LifeFile account ${PHARMACY_ACCOUNT_ID}`]
        .filter(Boolean)
        .join(' '),
      medicationId: medication.id,
      isActive: true,
    };

    if (existing) {
      // Prices already set by a person are theirs, not this script's to reset.
      await prisma.pharmacyProduct.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      const cost = placeholderCostCents(row);
      await prisma.pharmacyProduct.create({
        data: {
          ...data,
          pharmacyId: pharmacy.id,
          kitCode: row.kitCode,
          costOfGoodsCents: cost,
          sellPriceCents: Math.round((cost * 2.6) / 50) * 50,
        },
      });
      created += 1;
    }
  }

  console.log(`${pharmacy.name}: ${created} products created, ${updated} updated.`);
  console.log(
    'Cost and sell prices are placeholders derived from fill size — the pharmacy list ' +
      'carries neither. Set the real figures in Super Admin → Pharmacies.',
  );
  console.log(
    `${ADDITIONS.length} of these carry medIds and kit codes we generated, not First Choice's: ` +
      `${[...new Set(ADDITIONS.map((row) => row.visitType))].join(', ')}. ` +
      'Replace them when the pharmacy supplies its full list.',
  );
}

const titleCase = (value: string) =>
  value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

// Only when run directly. `reconcile-catalogue.ts` imports CATALOGUE from here
// for the list of real medIds, and importing a module must not reseed a database
// as a side effect.
if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
