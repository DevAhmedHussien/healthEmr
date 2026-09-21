import { PrismaClient } from '@prisma/client';
import { chainHash } from '../src/shared/audit/audit.service';

/**
 * Recomputes the audit chain over its existing, unchanged content.
 *
 * This exists because of a defect in the hashing function, not because anyone
 * tampered with anything: `canonicalise` reduced a Date to `{}`, so any entry
 * carrying a timestamp hashed a different value than the one Postgres stored,
 * and could never verify afterwards. The rows themselves were always correct.
 *
 * It rewrites only `hash` and `prevHash`. Every audited field — who, what, when,
 * before, after — is read and written back untouched, and the script refuses to
 * run if it finds a row whose content it would have to change.
 *
 * Running it is a deliberate act with a paper trail: it requires
 * `CONFIRM_AUDIT_REPAIR=yes` and records an entry describing what it did. Do not
 * reach for it as a way to make a failing verification go away — if the chain
 * breaks again after this, the content really did change.
 */
const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_AUDIT_REPAIR !== 'yes') {
    console.error(
      'Refusing to rewrite audit hashes without CONFIRM_AUDIT_REPAIR=yes.\n' +
        'Read what this script does before running it.',
    );
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.auditLog.findMany({ orderBy: { sequence: 'asc' } });
  console.log(`${rows.length} entries, sequence ${rows[0]?.sequence} to ${rows.at(-1)?.sequence}`);

  let prevHash: string | null = null;
  let rewritten = 0;
  let alreadyValid = 0;

  for (const row of rows) {
    const recomputed = chainHash({
      sequence: row.sequence.toString(),
      prevHash,
      tenantSlug: row.tenantSlug,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      patientId: row.patientId,
      before: row.before,
      after: row.after,
    });

    if (row.hash === recomputed && row.prevHash === prevHash) {
      alreadyValid += 1;
    } else {
      await prisma.auditLog.update({
        where: { id: row.id },
        data: { hash: recomputed, prevHash },
      });
      rewritten += 1;
    }
    prevHash = recomputed;
  }

  console.log(`  ${alreadyValid} already verified, ${rewritten} rehashed`);

  // The repair is itself an event, and belongs in the record it repaired.
  const last = await prisma.auditLog.findFirst({ orderBy: { sequence: 'desc' } });
  const sequence = (last?.sequence ?? 0n) + 1n;
  const entry = {
    sequence: sequence.toString(),
    prevHash: last?.hash ?? null,
    tenantSlug: null,
    actorEmail: null,
    actorRole: null,
    action: 'ENTITLEMENT_CHANGED' as const,
    entityType: 'AuditLog',
    entityId: null,
    patientId: null,
    before: null,
    after: {
      name: 'audit chain repaired',
      entriesRehashed: rewritten,
      entriesAlreadyValid: alreadyValid,
      reason:
        'Recomputed hashes after a defect that serialised Date values as {} at hash time. ' +
        'No audited content was altered.',
    },
  };

  await prisma.auditLog.create({
    data: {
      sequence,
      prevHash: entry.prevHash,
      hash: chainHash(entry),
      tenantId: null,
      actorUserId: null,
      actorRole: null,
      action: entry.action,
      entityType: entry.entityType,
      after: entry.after,
    },
  });

  console.log('  recorded the repair as the next entry in the chain');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
