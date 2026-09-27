/**
 * Seeds a working two-tenant platform.
 *
 * A second tenant exists from day one on purpose: with only one, every
 * isolation bug looks like correct behaviour.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * A seeded clinician's signature.
 *
 * Drawn as an SVG path rather than shipped as a binary blob, so the seed stays
 * readable and each clinician gets a mark of their own rather than everyone
 * sharing one squiggle. Written unencrypted: `PhiCryptoService.decrypt` passes
 * through anything without the `phi.v1:` prefix, so seed data reads correctly
 * while anything a real clinician draws is encrypted on the way in.
 */
function seedSignature(name: string): string {
  // Two loops and a flourish, nudged by the name so they differ from each other.
  const lean = (name.charCodeAt(0) % 7) - 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 70">
  <path d="M8 52 C ${28 + lean} 14, ${52 + lean} 14, 64 46 S ${96 + lean} 18, 116 44 S 150 12, 168 40 L 232 30"
        fill="none" stroke="#0d1b2a" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}



const prisma = new PrismaClient();

const hash = (password: string) =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

/** States where async prescribing is permitted. Placeholder — see D7. */
const ASYNC_ALLOWED = ['CA', 'TX', 'FL', 'AZ', 'NV', 'CO', 'WA', 'OR', 'GA', 'NC'];
const ASYNC_BLOCKED = ['AR', 'NY', 'AL', 'ID'];

const CATEGORIES: Array<{ slug: string; name: string; isFollowUp: boolean; parent?: string }> = [
  { slug: 'weightloss', name: 'Weight Loss', isFollowUp: false },
  { slug: 'weightlossfollowup', name: 'Weight Loss Follow-up', isFollowUp: true, parent: 'weightloss' },
  { slug: 'ED', name: 'Sexual Health', isFollowUp: false },
  { slug: 'EDfollowup', name: 'Sexual Health Follow-up', isFollowUp: true, parent: 'ED' },
  { slug: 'hairloss', name: 'Hair Growth', isFollowUp: false },
  { slug: 'hairlossfollowup', name: 'Hair Growth Follow-up', isFollowUp: true, parent: 'hairloss' },
  { slug: 'antiNausea', name: 'Anti-Nausea', isFollowUp: false },
  { slug: 'antiAging', name: 'Wellness', isFollowUp: false },
  { slug: 'menopause', name: 'Menopause', isFollowUp: false },
  { slug: 'testVisitType', name: 'Integration Test', isFollowUp: false },
];

const MEDICATIONS = [
  { medId: 'SEMA-2.5', name: 'Semaglutide 2.5mg/mL', strength: '2.5mg/mL', form: 'INJECTABLE', compounded: true, category: 'weightloss' },
  { medId: 'SEMA-5.0', name: 'Semaglutide 5mg/mL', strength: '5mg/mL', form: 'INJECTABLE', compounded: true, category: 'weightloss' },
  { medId: 'TIRZ-10', name: 'Tirzepatide 10mg/mL', strength: '10mg/mL', form: 'INJECTABLE', compounded: true, category: 'weightloss' },
  { medId: 'SILD-100', name: 'Sildenafil 100mg', strength: '100mg', form: 'ORAL', compounded: false, category: 'ED' },
  { medId: 'TADA-20', name: 'Tadalafil 20mg', strength: '20mg', form: 'ORAL', compounded: false, category: 'ED' },
  { medId: 'FIN-1', name: 'Finasteride 1mg', strength: '1mg', form: 'ORAL', compounded: false, category: 'hairloss' },
  { medId: 'ONDAN-8', name: 'Ondansetron ODT 8mg', strength: '8mg', form: 'ORAL', compounded: true, category: 'antiNausea' },
  { medId: 'NAD-100', name: 'NAD+ 100mg/mL', strength: '100mg/mL', form: 'INJECTABLE', compounded: true, category: 'antiAging' },
  { medId: 'TEST-MED', name: 'Integration Test Medication', strength: '1mg', form: 'ORAL', compounded: false, category: 'testVisitType' },
];

async function main(): Promise<void> {
  console.warn('Seeding HealthEMR…');

  // ── state policy ─────────────────────────────────────────────────────
  for (const state of [...ASYNC_ALLOWED, ...ASYNC_BLOCKED]) {
    const allows = ASYNC_ALLOWED.includes(state);
    await prisma.statePolicy.upsert({
      where: { state },
      create: {
        state,
        allowsAsyncPrescribing: allows,
        requiresSynchronousInitial: !allows,
        notes: allows
          ? 'Placeholder — confirm with counsel before go-live.'
          : 'Async prescribing not permitted. Requires real-time interaction.',
      },
      update: {},
    });
  }

  // ── catalog ──────────────────────────────────────────────────────────
  const categoryBySlug = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        name: category.name,
        isFollowUp: category.isFollowUp,
        sortOrder: index,
      },
      update: {},
      select: { id: true },
    });
    categoryBySlug.set(category.slug, row.id);
  }
  for (const category of CATEGORIES.filter((c) => c.parent)) {
    await prisma.category.update({
      where: { slug: category.slug },
      data: { parentCategoryId: categoryBySlug.get(category.parent!) },
    });
  }

  const medicationByMedId = new Map<string, string>();
  for (const medication of MEDICATIONS) {
    const row = await prisma.medication.upsert({
      where: { medId: medication.medId },
      create: {
        medId: medication.medId,
        name: medication.name,
        strength: medication.strength,
        form: medication.form as Prisma.MedicationCreateInput['form'],
        isCompounded: medication.compounded,
        isBranded: !medication.compounded,
      },
      update: {},
      select: { id: true },
    });
    medicationByMedId.set(medication.medId, row.id);

    const categoryId = categoryBySlug.get(medication.category)!;
    await prisma.categoryMedication.upsert({
      where: { categoryId_medicationId: { categoryId, medicationId: row.id } },
      create: { categoryId, medicationId: row.id },
      update: {},
    });
  }

  // ── pharmacies ───────────────────────────────────────────────────────
  const firstChoice = await prisma.pharmacy.upsert({
    where: { slug: 'first-choice' },
    create: {
      slug: 'first-choice',
      name: 'First Choice Pharmacy',
      platform: 'LIFEFILE',
      dispensesCompounded: true,
      dispensesBranded: false,
      config: {
        create: {
          baseUrl: 'https://api.lifefile.net',
          authStrategy: 'BEARER',
          credentialRef: '/healthemr/prod/pharmacy/first-choice/token',
          timeoutMs: 20000,
        },
      },
    },
    update: {},
    select: { id: true },
  });

  const retailPartner = await prisma.pharmacy.upsert({
    where: { slug: 'retail-partner' },
    create: {
      slug: 'retail-partner',
      name: 'Retail Partner Pharmacy',
      platform: 'GENERIC_HTTP',
      dispensesCompounded: false,
      dispensesBranded: true,
      config: {
        create: {
          baseUrl: 'https://example-pharmacy.test/api',
          authStrategy: 'API_KEY_HEADER',
          credentialRef: '/healthemr/prod/pharmacy/retail-partner/key',
          staticHeaders: { 'X-Partner': 'healthemr' },
        },
      },
    },
    update: {},
    select: { id: true },
  });

  // ── providers ────────────────────────────────────────────────────────
  const providerSpecs = [
    { email: 'dr.reyes@healthemr.test', first: 'Alix', last: 'Reyes', npi: '1234567890', states: ['CA', 'NV', 'AZ'] },
    { email: 'dr.okafor@healthemr.test', first: 'Ndidi', last: 'Okafor', npi: '2345678901', states: ['TX', 'FL', 'GA'] },
    { email: 'dr.lindqvist@healthemr.test', first: 'Sam', last: 'Lindqvist', npi: '3456789012', states: ['CA', 'WA', 'OR', 'CO'] },
  ];

  const providerIds: string[] = [];
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 2);

  for (const spec of providerSpecs) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        email: spec.email,
        passwordHash: await hash('Provider!2026'),
        role: 'PROVIDER',
        firstName: spec.first,
        lastName: spec.last,
        isEmailVerified: true,
      },
      update: {},
      select: { id: true },
    });

    // A clinician without a signature cannot sign anything, so a seeded one
    // without a signature is not a working fixture — it is an account that
    // reaches the last step of the flow and stops.
    const signatureName = `${spec.first} ${spec.last}, MD`;
    const profile = await prisma.providerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        npi: spec.npi,
        credentials: 'MD',
        maxOpenRequests: 25,
        signatureImage: seedSignature(signatureName),
        signatureName,
        signatureCapturedAt: new Date(),
      },
      update: {
        // Backfilled on a re-seed, so a database created before signatures
        // existed starts working rather than failing at the last step.
        signatureImage: seedSignature(signatureName),
        signatureName,
        signatureCapturedAt: new Date(),
      },
      select: { id: true },
    });
    providerIds.push(profile.id);

    for (const state of spec.states) {
      await prisma.providerLicense.upsert({
        where: { providerId_state: { providerId: profile.id, state } },
        create: {
          providerId: profile.id,
          state,
          licenseNumber: `${state}-${spec.npi.slice(0, 5)}`,
          expiresAt: expiry,
        },
        update: {},
      });
    }

    for (const slug of CATEGORIES.map((c) => c.slug)) {
      const categoryId = categoryBySlug.get(slug)!;
      await prisma.providerCategory.upsert({
        where: { providerId_categoryId: { providerId: profile.id, categoryId } },
        create: { providerId: profile.id, categoryId },
        update: {},
      });
    }
  }

  // ── tenants ──────────────────────────────────────────────────────────
  const tenantSpecs = [
    { slug: 'joeyMed', name: 'JoeyMed', admin: 'admin@joeymed.test', pharmacies: [firstChoice.id, retailPartner.id] },
    { slug: 'acmeHealth', name: 'Acme Health', admin: 'admin@acmehealth.test', pharmacies: [retailPartner.id] },
  ];

  const issuedKeys: Array<{ slug: string; key: string }> = [];

  for (const spec of tenantSpecs) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: spec.slug },
      create: { slug: spec.slug, name: spec.name, contactEmail: spec.admin },
      update: {},
      select: { id: true },
    });

    await prisma.user.upsert({
      where: { email: spec.admin },
      create: {
        email: spec.admin,
        passwordHash: await hash('Admin!2026'),
        role: 'ADMIN',
        tenantId: tenant.id,
        firstName: spec.name,
        lastName: 'Admin',
        isEmailVerified: true,
      },
      update: {},
    });

    for (const slug of CATEGORIES.map((c) => c.slug)) {
      const categoryId = categoryBySlug.get(slug)!;
      await prisma.tenantCategory.upsert({
        where: { tenantId_categoryId: { tenantId: tenant.id, categoryId } },
        create: { tenantId: tenant.id, categoryId },
        update: {},
      });
    }

    // Acme deliberately gets a smaller catalog, so entitlement bugs surface.
    const medIds = spec.slug === 'joeyMed'
      ? MEDICATIONS.map((m) => m.medId)
      : ['SILD-100', 'TADA-20', 'FIN-1', 'TEST-MED'];

    for (const medId of medIds) {
      const medicationId = medicationByMedId.get(medId)!;
      await prisma.tenantMedication.upsert({
        where: { tenantId_medicationId: { tenantId: tenant.id, medicationId } },
        create: { tenantId: tenant.id, medicationId },
        update: {},
      });
    }

    for (const [index, pharmacyId] of spec.pharmacies.entries()) {
      await prisma.tenantPharmacy.upsert({
        where: { tenantId_pharmacyId: { tenantId: tenant.id, pharmacyId } },
        create: { tenantId: tenant.id, pharmacyId, isDefault: index === 0 },
        update: {},
      });
    }

    for (const providerId of providerIds) {
      await prisma.tenantProvider.upsert({
        where: { tenantId_providerId: { tenantId: tenant.id, providerId } },
        create: { tenantId: tenant.id, providerId },
        update: {},
      });
    }

    const existingKey = await prisma.tenantApiKey.findFirst({
      where: { tenantId: tenant.id, name: 'seed', revokedAt: null },
    });
    if (!existingKey) {
      const prefix = randomBytes(9).toString('base64url').slice(0, 12);
      const key = `hemr_${prefix}${randomBytes(32).toString('base64url')}`;
      await prisma.tenantApiKey.create({
        data: {
          tenantId: tenant.id,
          name: 'seed',
          keyPrefix: prefix,
          keyHash: await argon2.hash(key, { type: argon2.argon2id }),
          scopes: ['visit:create', 'visit:read', 'pharmacy:read'],
        },
      });
      issuedKeys.push({ slug: spec.slug, key });
    }
  }

  // ── platform owner ───────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'super@healthemr.test' },
    create: {
      email: 'super@healthemr.test',
      passwordHash: await hash('Super!2026'),
      /**
       * OWNER, not SUPER_ADMIN.
       *
       * The owner console is matched on the role exactly — a super admin must
       * not stand in for an owner, or the division of authority would be one
       * request deep. Seeding this account as a super admin therefore left a
       * fresh install with nobody who could grant anything, including to
       * themselves: permissions empty, /v1/owner/* unreachable, and no way to
       * bootstrap the authority model from inside the product.
       *
       * It looked correct on any database that had been running a while,
       * because a migration promoted the existing row. A migration cannot
       * promote a row that does not exist yet, so only clean installs were
       * broken — which is to say, every new machine.
       */
      role: 'OWNER',
      firstName: 'Platform',
      lastName: 'Owner',
      isEmailVerified: true,
    },
    update: {},
  });

  console.warn('\nSeed complete.\n');
  console.warn('  super@healthemr.test        Super!2026      (OWNER)');
  console.warn('  admin@joeymed.test          Admin!2026      (ADMIN · joeyMed)');
  console.warn('  admin@acmehealth.test       Admin!2026      (ADMIN · acmeHealth)');
  console.warn('  dr.reyes@healthemr.test     Provider!2026   (PROVIDER · CA NV AZ)');
  console.warn('  dr.okafor@healthemr.test    Provider!2026   (PROVIDER · TX FL GA)');
  console.warn('  dr.lindqvist@healthemr.test Provider!2026   (PROVIDER · CA WA OR CO)');

  if (issuedKeys.length) {
    console.warn('\nTenant API keys — shown once, store them now:');
    for (const issued of issuedKeys) console.warn(`  ${issued.slug.padEnd(12)} ${issued.key}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
