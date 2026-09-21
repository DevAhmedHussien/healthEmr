/**
 * Provision Tila Health as a tenant of this EMR.
 *
 * Run once, from the health-emr repo. It prints an API key — that is the only
 * time the key is visible, because only its argon2 hash is stored. Copy it
 * into Tila's `.env` as `EMR_API_KEY`.
 *
 * Idempotent on the tenant, its entitlements and its webhook endpoint. The
 * API key is only issued if there is no live one named `tila-local`, so
 * re-running does not quietly invalidate the one already in a .env file.
 */
import { createCipheriv, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const SLUG = 'tilahealth';
const KEY_NAME = 'tila-local';
const WEBHOOK_NAME = 'tila-local';
const WEBHOOK_URL = process.env.TILA_WEBHOOK_URL ?? 'http://localhost:3200/api/webhooks/healthemr';

/**
 * The same AES-256-GCM envelope `PhiCryptoService` writes.
 *
 * Reimplemented here rather than booting the Nest container for a one-off
 * script. If `PHI_ENCRYPTION_KEY` is unset the service stores plaintext, and
 * so does this — matching it exactly is the point, because the API has to be
 * able to decrypt what this writes.
 */
function encryptForPhi(plaintext: string): string {
  const raw = process.env.PHI_ENCRYPTION_KEY;
  if (!raw) return plaintext;

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('PHI_ENCRYPTION_KEY must decode to 32 bytes');

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `phi.v1:${iv.toString('base64')}.${tag.toString('base64')}.${payload.toString('base64')}`;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    create: { slug: SLUG, name: 'Tila Health', contactEmail: 'care@tilahealth.com' },
    update: { name: 'Tila Health' },
    select: { id: true, slug: true },
  });

  // Every treatment area, so nothing Tila sells is refused as un-entitled.
  const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
  for (const category of categories) {
    await prisma.tenantCategory.upsert({
      where: { tenantId_categoryId: { tenantId: tenant.id, categoryId: category.id } },
      create: { tenantId: tenant.id, categoryId: category.id },
      update: {},
    });
  }

  const medications = await prisma.medication.findMany({ select: { id: true, medId: true } });
  for (const medication of medications) {
    await prisma.tenantMedication.upsert({
      where: { tenantId_medicationId: { tenantId: tenant.id, medicationId: medication.id } },
      create: { tenantId: tenant.id, medicationId: medication.id },
      update: {},
    });
  }

  const pharmacies = await prisma.pharmacy.findMany({ select: { id: true, slug: true } });
  for (const [index, pharmacy] of pharmacies.entries()) {
    await prisma.tenantPharmacy.upsert({
      where: { tenantId_pharmacyId: { tenantId: tenant.id, pharmacyId: pharmacy.id } },
      create: { tenantId: tenant.id, pharmacyId: pharmacy.id, isDefault: index === 0 },
      update: {},
    });
  }

  const providers = await prisma.providerProfile.findMany({ select: { id: true } });
  for (const provider of providers) {
    await prisma.tenantProvider.upsert({
      where: { tenantId_providerId: { tenantId: tenant.id, providerId: provider.id } },
      create: { tenantId: tenant.id, providerId: provider.id },
      update: {},
    });
  }

  const existing = await prisma.tenantApiKey.findFirst({
    where: { tenantId: tenant.id, name: KEY_NAME, revokedAt: null },
  });

  let issued: string | null = null;
  if (!existing) {
    const prefix = randomBytes(9).toString('base64url').slice(0, 12);
    issued = `hemr_${prefix}${randomBytes(32).toString('base64url')}`;
    await prisma.tenantApiKey.create({
      data: {
        tenantId: tenant.id,
        name: KEY_NAME,
        keyPrefix: prefix,
        keyHash: await argon2.hash(issued, { type: argon2.argon2id }),
        scopes: ['visit:create', 'visit:read', 'pharmacy:read'],
      },
    });
  }

  // ── the webhook endpoint, so status flows back ──────────────────────
  const existingHook = await prisma.tenantWebhook.findFirst({
    where: { tenantId: tenant.id, url: WEBHOOK_URL },
  });

  let webhookSecret: string | null = null;
  let webhookToken: string | null = null;

  if (!existingHook) {
    webhookSecret = `whsec_${randomBytes(24).toString('base64url')}`;
    webhookToken = `tila_${randomBytes(24).toString('base64url')}`;

    await prisma.tenantWebhook.create({
      data: {
        tenantId: tenant.id,
        name: WEBHOOK_NAME,
        url: WEBHOOK_URL,
        authCipher: encryptForPhi(webhookToken),
        secretRef: webhookSecret,
        // Every event. A client that only hears outcomes cannot tell
        // "waiting on a clinician" from "never arrived".
        events: [
          'CONSULT_RECEIVED',
          'CONSULT_CONCLUDED',
          'RX_WRITTEN',
          'CONSULT_CANCELED',
          'PHARMACY_ORDER_IN_FULFILLMENT',
          'PHARMACY_ORDER_SHIPPED',
          'PHARMACY_ORDER_DELIVERED',
          'NAME_UPDATE',
          'DOCTOR_CHAT',
        ],
        isActive: true,
      },
    });
  }

  console.log(`\n  Tenant "${tenant.slug}" is provisioned.`);
  console.log(`  ${categories.length} categories · ${medications.length} medications · ${pharmacies.length} pharmacies · ${providers.length} providers`);
  console.log(`  Default pharmacy: ${pharmacies[0]?.slug ?? 'none'}\n`);

  console.log(`  Webhook: ${existingHook ? 'already registered, left alone' : WEBHOOK_URL}\n`);

  if (issued || webhookSecret) {
    console.log('  Put these in tila-health/.env — they are not shown again:\n');
    if (issued) {
      console.log(`    EMR_BASE_URL="http://localhost:4000"`);
      console.log(`    EMR_TENANT_SLUG="${SLUG}"`);
      console.log(`    EMR_API_KEY="${issued}"`);
      console.log(`    EMR_DEFAULT_PHARMACY="${pharmacies[0]?.slug ?? 'first-choice'}"`);
    }
    if (webhookSecret && webhookToken) {
      console.log(`    EMR_WEBHOOK_SECRET="${webhookSecret}"`);
      console.log(`    EMR_WEBHOOK_TOKEN="${webhookToken}"`);
    }
    console.log();
  }

  if (!issued) {
    console.log(`  An API key named "${KEY_NAME}" already exists and was left alone.`);
    console.log('  Revoke it in the super-admin, or rename KEY_NAME here, to issue a new one.\n');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
