/**
 * Sets up a clean walkthrough: one patient with a known password and one visit
 * sitting in a provider's queue awaiting approval.
 *
 * Re-runnable. Wipes the previous demo patient so the walkthrough always starts
 * from the same place.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const API = 'http://localhost:4000';

const DEMO = {
  email: 'sofia.reyes@demo.test',
  password: 'Patient!2026',
  phone: '5550100200',
  firstName: 'Sofia',
  lastName: 'Reyes',
  dob: '06/14/1989',
  state: 'CA',
};

async function main() {
  // ── clean slate ────────────────────────────────────────────────────────
  const existing = await prisma.patient.findFirst({
    where: { phone: DEMO.phone },
    include: { user: true },
  });

  if (existing) {
    await prisma.prescriptionRequest.deleteMany({ where: { patientId: existing.id } });
    await prisma.patient.delete({ where: { id: existing.id } });
    if (existing.userId) {
      await prisma.user.delete({ where: { id: existing.userId } }).catch(() => undefined);
    }
    console.log('  cleared previous demo patient');
  }

  // ── a tenant API key so we can post the intake as JoeyMed would ────────
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'joeyMed' } });
  const prefix = randomBytes(9).toString('base64url').slice(0, 12);
  const apiKey = `hemr_${prefix}${randomBytes(32).toString('base64url')}`;
  await prisma.tenantApiKey.create({
    data: {
      tenantId: tenant.id,
      name: 'walkthrough',
      keyPrefix: prefix,
      keyHash: await argon2.hash(apiKey, { type: argon2.argon2id }),
      scopes: ['visit:create'],
    },
  });

  // ── post the intake exactly as a telehealth partner would ──────────────
  const masterId = `DEMO-${Date.now().toString(36).toUpperCase()}`;
  const response = await fetch(`${API}/partner/v1/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      formObj: {
        consentsSigned: true,
        firstName: DEMO.firstName,
        lastName: DEMO.lastName,
        dob: DEMO.dob,
        phone: DEMO.phone,
        email: DEMO.email,
        address: '412 Ocean Ave',
        city: 'San Francisco',
        state: DEMO.state,
        zip: '94112',
        sex: 'Female',
        selfReportedMeds: 'Metformin 500mg',
        allergies: 'Penicillin, shellfish',
        medicalConditions: 'Type 2 diabetes',
        patientPreference: [
          { name: 'Semaglutide', strength: '2.5mg/mL', quantity: '1', refills: '2', daysSupply: '30', medId: 'SEMA-2.5' },
          { name: 'Tirzepatide', strength: '10mg/mL', quantity: '1', refills: '2', daysSupply: '30', medId: 'TIRZ-10' },
        ],
        Q1: 'Have you taken a GLP-1 medication before? POSSIBLE ANSWERS: Yes; No',
        A1: 'Yes, semaglutide for 4 months in 2025',
        Q2: 'What is your current weight in pounds?',
        A2: '228',
        Q3: 'What is your goal weight?',
        A3: '175',
        Q4: 'Any history of pancreatitis or thyroid cancer? POSSIBLE ANSWERS: Yes; No',
        A4: 'No',
      },
      pharmacyId: 'first-choice',
      masterId,
      company: 'joeyMed',
      visitType: 'weightloss',
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    console.error('  intake failed:', body);
    process.exit(1);
  }

  // ── give the patient a password they can actually sign in with ─────────
  const patient = await prisma.patient.findFirstOrThrow({
    where: { phone: DEMO.phone },
    include: { user: true, allergies: true },
  });

  await prisma.user.update({
    where: { id: patient.userId! },
    data: {
      passwordHash: await argon2.hash(DEMO.password, { type: argon2.argon2id }),
      isEmailVerified: true,
    },
  });

  const visit = await prisma.prescriptionRequest.findFirstOrThrow({
    where: { externalMasterId: masterId },
    include: {
      items: true,
      assignedProvider: { include: { user: true, licenses: { where: { state: DEMO.state } } } },
    },
  });

  console.log('\n  Walkthrough ready.\n');
  console.log(`  visit        ${masterId}  (${visit.status})`);
  console.log(`  patient      ${DEMO.firstName} ${DEMO.lastName}  ${patient.mrn}  ${DEMO.state}`);
  console.log(`  allergies    ${patient.allergies.map((a) => a.substance).join(', ')}`);
  console.log(`  lines        ${visit.items.map((i) => `${i.nameText} ${i.strength}`).join('  |  ')}`);
  console.log(`  assigned to  ${visit.assignedProvider?.user.firstName} ${visit.assignedProvider?.user.lastName}` +
              `  (licence ${visit.assignedProvider?.licenses[0]?.licenseNumber})`);
  console.log(`  patient login ${DEMO.email} / ${DEMO.password}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
