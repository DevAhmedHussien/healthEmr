import { PrismaClient } from '@prisma/client';
import { ALL_PRODUCTS } from './seed-first-choice-catalogue';

/**
 * Makes the catalogue match reality.
 *
 * Two jobs. The category list becomes exactly the visit types this platform
 * treats — no more, no fewer — and every invented demo medication is removed so
 * the only products left are ones a pharmacy actually stocks.
 *
 * Nothing referenced by a real record is deleted. A medication a patient was
 * prescribed is part of that prescription's meaning: removing it would leave a
 * chart that cannot say what was dispensed. Those are deactivated instead, which
 * takes them out of every dropdown and every intake while keeping the history
 * readable. The script reports both counts so the difference is visible.
 *
 * Safe to run repeatedly.
 */
const prisma = new PrismaClient();

/** The visit types a client may submit, and nothing else. */
const CATEGORIES: Array<{ slug: string; name: string; followUpOf?: string }> = [
  { slug: 'testVisitType', name: 'Integration Test' },
  { slug: 'weightloss', name: 'Weight Loss' },
  { slug: 'weightlossfollowup', name: 'Weight Loss Follow-up', followUpOf: 'weightloss' },
  { slug: 'ED', name: 'Sexual Health' },
  { slug: 'EDfollowup', name: 'Sexual Health Follow-up', followUpOf: 'ED' },
  { slug: 'antiAging', name: 'Anti-Aging' },
  { slug: 'antiAgingFollowup', name: 'Anti-Aging Follow-up', followUpOf: 'antiAging' },
  { slug: 'antiNausea', name: 'Anti-Nausea' },
  { slug: 'antiNauseaFollowup', name: 'Anti-Nausea Follow-up', followUpOf: 'antiNausea' },
  { slug: 'menopause', name: 'Menopause' },
  { slug: 'menopauseFollowup', name: 'Menopause Follow-up', followUpOf: 'menopause' },
  { slug: 'hairloss', name: 'Hair Loss' },
  { slug: 'hairlossfollowup', name: 'Hair Loss Follow-up', followUpOf: 'hairloss' },
  { slug: 'skin', name: 'Skin' },
  { slug: 'hormones', name: 'Hormones' },
  { slug: 'hormonesFollowup', name: 'Hormones Follow-up', followUpOf: 'hormones' },
  { slug: 'peptides', name: 'Peptides' },
  { slug: 'peptidesFollowup', name: 'Peptides Follow-up', followUpOf: 'peptides' },
];

async function reconcileCategories() {
  const wanted = new Set(CATEGORIES.map((row) => row.slug));
  const ids = new Map<string, string>();

  for (const [index, row] of CATEGORIES.entries()) {
    const category = await prisma.category.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        name: row.name,
        isFollowUp: Boolean(row.followUpOf),
        sortOrder: index,
        isActive: true,
      },
      update: {
        name: row.name,
        isFollowUp: Boolean(row.followUpOf),
        sortOrder: index,
        isActive: true,
      },
      select: { id: true },
    });
    ids.set(row.slug, category.id);
  }

  // Link each follow-up to what it follows, now that every row exists.
  for (const row of CATEGORIES) {
    if (!row.followUpOf) continue;
    await prisma.category.update({
      where: { slug: row.slug },
      data: { parentCategoryId: ids.get(row.followUpOf) ?? null },
    });
  }

  // Anything else is retired rather than deleted: visits already point at it.
  const retired = await prisma.category.updateMany({
    where: { slug: { notIn: [...wanted] }, isActive: true },
    data: { isActive: false },
  });

  console.log(`Categories: ${CATEGORIES.length} in place, ${retired.count} retired.`);
}

async function reconcileMedications() {
  // Real means "on a pharmacy's own product list", and the only such list we
  // have is First Choice's. Being attached to a product is not enough — the demo
  // products at the other pharmacies were invented too.
  const real = await prisma.medication.findMany({
    where: { medId: { in: ALL_PRODUCTS.map((row) => row.medId) } },
    select: { id: true },
  });
  const keep = new Set(real.map((row) => row.id));

  const strays = await prisma.medication.findMany({
    where: { id: { notIn: [...keep] } },
    select: { id: true, medId: true, name: true },
  });

  let deleted = 0;
  const kept: string[] = [];

  for (const medication of strays) {
    const [items, prescriptions, patientMeds] = await Promise.all([
      prisma.prescriptionRequestItem.count({ where: { medicationId: medication.id } }),
      prisma.prescription.count({ where: { medicationId: medication.id } }),
      prisma.patientMedication.count({ where: { medicationId: medication.id } }),
    ]);

    if (items || prescriptions || patientMeds) {
      // Referenced by a chart. Out of every dropdown, still readable in history.
      await prisma.medication.update({
        where: { id: medication.id },
        data: { isActive: false },
      });
      kept.push(`${medication.name} (${items + prescriptions + patientMeds} references)`);
      continue;
    }

    await prisma.categoryMedication.deleteMany({ where: { medicationId: medication.id } });
    await prisma.tenantMedication.deleteMany({ where: { medicationId: medication.id } });
    await prisma.pharmacyFormularyItem.deleteMany({ where: { medicationId: medication.id } });
    await prisma.medication.delete({ where: { id: medication.id } });
    deleted += 1;
  }

  // Products built on an invented medication go with it, or the catalogue keeps
  // offering something that no longer exists.
  const orphans = await prisma.pharmacyProduct.deleteMany({
    where: { OR: [{ medicationId: null }, { medicationId: { notIn: [...keep] } }] },
  });

  // A category with nothing in it is noise in every dropdown.
  const emptyGroups = await prisma.pharmacyCategory.deleteMany({
    where: { products: { none: {} } },
  });

  console.log(`Medications: ${keep.size} real, ${deleted} invented ones deleted.`);
  console.log(`Products: ${orphans.count} invented ones removed.`);
  console.log(`Pharmacy categories: ${emptyGroups.count} emptied and removed.`);
  if (kept.length) {
    console.log(`  Deactivated rather than deleted, because a chart refers to them:`);
    kept.forEach((line) => console.log(`    · ${line}`));
  }
}

/**
 * Entitles every client business to the real catalogue.
 *
 * Intake refuses a medId the tenant is not entitled to, which is correct — but
 * removing the invented medications left the real ones entitled to nobody, so
 * every intake would be refused with "No match". A client contracted to a
 * pharmacy can order what that pharmacy stocks; narrowing it further is a
 * commercial decision, made per client in the console.
 */
async function entitleTenants() {
  const [tenants, medications] = await Promise.all([
    prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
    prisma.medication.findMany({
      where: { medId: { in: ALL_PRODUCTS.map((row) => row.medId) } },
      select: { id: true },
    }),
  ]);

  let granted = 0;
  for (const tenant of tenants) {
    for (const medication of medications) {
      const existing = await prisma.tenantMedication.findUnique({
        where: { tenantId_medicationId: { tenantId: tenant.id, medicationId: medication.id } },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.tenantMedication.create({
        data: { tenantId: tenant.id, medicationId: medication.id, isEnabled: true },
      });
      granted += 1;
    }
  }

  console.log(`Entitlements: ${granted} granted across ${tenants.length} client accounts.`);
}

/** Every client also needs the visit types those products belong to. */
async function entitleCategories() {
  const [tenants, categories] = await Promise.all([
    prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);

  let granted = 0;
  for (const tenant of tenants) {
    for (const category of categories) {
      const existing = await prisma.tenantCategory.findUnique({
        where: { tenantId_categoryId: { tenantId: tenant.id, categoryId: category.id } },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.tenantCategory.create({
        data: { tenantId: tenant.id, categoryId: category.id, isEnabled: true },
      });
      granted += 1;
    }
  }

  console.log(`Visit types: ${granted} enabled across ${tenants.length} client accounts.`);
}

async function main() {
  await reconcileCategories();
  await reconcileMedications();
  await entitleTenants();
  await entitleCategories();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
