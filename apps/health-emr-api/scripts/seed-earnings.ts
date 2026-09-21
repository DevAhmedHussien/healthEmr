/**
 * Seeds the default provider rate and backfills earnings for reviews already
 * decided, so the console shows real numbers rather than an empty ledger.
 *
 * Re-runnable: the unique constraint on requestId means a second run is a no-op.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.providerFeeSchedule.findFirst({
    where: { providerId: null, categoryId: null, effectiveTo: null },
  });

  if (!existing) {
    await prisma.providerFeeSchedule.create({
      data: {
        providerId: null,
        categoryId: null,
        amountCents: 100,
        effectiveFrom: new Date('2020-01-01'),
        note: 'Platform default: $1.00 per completed review, approved or denied.',
      },
    });
    console.log('  created default rate: $1.00 per completed review');
  }

  const decided = await prisma.prescriptionRequest.findMany({
    where: {
      status: { in: ['APPROVED', 'DENIED'] },
      assignedProviderId: { not: null },
      providerEarning: null,
    },
    select: {
      id: true, tenantId: true, categoryId: true, assignedProviderId: true,
      status: true, decidedAt: true, createdAt: true,
    },
  });

  for (const request of decided) {
    await prisma.providerEarning.create({
      data: {
        requestId: request.id,
        providerId: request.assignedProviderId!,
        tenantId: request.tenantId,
        amountCents: 100,
        outcome: request.status,
        earnedAt: request.decidedAt ?? request.createdAt,
        status: 'PENDING',
      },
    });
  }

  const total = await prisma.providerEarning.aggregate({ _sum: { amountCents: true }, _count: true });
  console.log(`  backfilled ${decided.length} earnings`);
  console.log(`  ledger: ${total._count} reviews, $${((total._sum.amountCents ?? 0) / 100).toFixed(2)} owed`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
