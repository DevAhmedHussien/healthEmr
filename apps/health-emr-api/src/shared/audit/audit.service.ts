import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentContext, markAudited } from '../auth/request-context';

/**
 * Exactly the fields the chain hash covers.
 *
 * Note what is *not* here: `tenantId` and `actorUserId`. Both are foreign keys
 * declared SET NULL on delete, so removing a user or a tenant silently rewrote
 * the content of every entry they appeared in — and the chain, correctly, called
 * that tampering. Attribution is hashed as the text below instead, which nothing
 * outside this service can change.
 */
export interface ChainedFields {
  sequence: string;
  prevHash: string | null;
  tenantSlug: string | null;
  actorEmail: string | null;
  actorRole: Role | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  patientId: string | null;
  before: unknown;
  after: unknown;
}

/**
 * Recursively sorts object keys so serialisation does not depend on key order.
 *
 * This is load-bearing, not tidiness. `before`/`after` are stored in a Postgres
 * `jsonb` column, and jsonb does not preserve key order — it normalises. An
 * object hashed as {masterId, visitType, status} on write reads back as
 * {status, masterId, visitType}, so hashing the raw JSON made every row fail
 * verification. A tamper-evidence scheme that always cries tamper is worse than
 * none, because people stop believing it.
 */
function canonicalise(value: unknown): unknown {
  // A bigint would make JSON.stringify throw, and the sequence is one.
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  // Dates first, and this is not a nicety. A Date is an object with no own
  // enumerable keys, so the generic branch below reduced every date to `{}`
  // while Postgres stored the ISO string — meaning any entry carrying a
  // timestamp hashed one thing and persisted another, and could never verify
  // again. Serialise it the same way the database will.
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalise);

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = canonicalise(source[key]);
  }
  return sorted;
}

/**
 * The one definition of what a chain hash covers.
 *
 * Writing and verifying must agree byte-for-byte or verification is theatre, so
 * both paths call this rather than each building their own object.
 */
export function chainHash(fields: ChainedFields): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(fields))).digest('hex');
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  before?: unknown;
  after?: unknown;
  tenantId?: string | null;
  actorUserId?: string | null;
  actorRole?: Role | null;
  /** Overrides the request context, for jobs acting outside a request. */
  actorEmail?: string | null;
  tenantSlug?: string | null;
}

/**
 * Append-only, hash-chained audit trail.
 *
 * Each row's hash covers its own content plus the previous row's hash, so
 * deleting or editing an entry breaks every hash after it. `sequence` is unique
 * and monotonic, so a removed row also leaves a detectable gap. Together they
 * satisfy the tamper-evidence expectation for a six-year PHI retention window.
 *
 * Writes go through `raw` on purpose: an audit entry must be recorded even when
 * the acting request is platform-scoped or the tenant is unknown.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  /** Serialises hash-chain writes within this process. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = currentContext();
    markAudited();

    const task = this.chain.then(() => this.append(entry, ctx)).catch((error) => {
      // Never let an audit failure break the operation being audited, but make
      // it loud — a silent gap in the trail is the worst outcome.
      this.logger.error(`Failed to write audit entry for ${entry.entityType}`, error as Error);
    });

    this.chain = task;
    return task;
  }

  private async append(
    entry: AuditEntry,
    ctx: ReturnType<typeof currentContext>,
  ): Promise<void> {
    await this.prisma.raw.$transaction(async (tx) => {
      const previous = await tx.auditLog.findFirst({
        orderBy: { sequence: 'desc' },
        select: { sequence: true, hash: true },
      });

      const sequence = (previous?.sequence ?? 0n) + 1n;
      const prevHash = previous?.hash ?? null;

      const tenantId = entry.tenantId ?? ctx?.tenantId ?? null;
      const actorUserId = entry.actorUserId ?? ctx?.userId ?? null;

      // Resolved once per entry against the primary key. The alternative —
      // hashing the ids — is what broke the chain every time an account was
      // removed.
      const [actorEmail, tenantSlug] = await Promise.all([
        entry.actorEmail !== undefined
          ? Promise.resolve(entry.actorEmail)
          : actorUserId
            ? tx.user.findUnique({ where: { id: actorUserId }, select: { email: true } }).then((u) => u?.email ?? null)
            : Promise.resolve(null),
        entry.tenantSlug !== undefined
          ? Promise.resolve(entry.tenantSlug)
          : tenantId
            ? tx.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }).then((t) => t?.slug ?? null)
            : Promise.resolve(null),
      ]);

      const payload: ChainedFields = {
        sequence: sequence.toString(),
        prevHash,
        tenantSlug,
        actorEmail,
        actorRole: entry.actorRole ?? ctx?.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        patientId: entry.patientId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
      };

      const hash = chainHash(payload);

      await tx.auditLog.create({
        data: {
          sequence,
          prevHash,
          hash,
          tenantId,
          actorUserId,
          actorEmail: payload.actorEmail,
          tenantSlug: payload.tenantSlug,
          actorRole: payload.actorRole,
          action: payload.action,
          entityType: payload.entityType,
          entityId: payload.entityId,
          patientId: payload.patientId,
          before: (payload.before ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (payload.after ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
        },
      });
    });
  }

  /**
   * Walks the chain and reports the first row whose hash does not reconcile.
   * Run it on a schedule; a broken chain is an incident, not a warning.
   */
  async verifyChain(limit = 10_000): Promise<{ ok: boolean; brokenAtSequence?: string }> {
    const rows = await this.prisma.raw.auditLog.findMany({
      orderBy: { sequence: 'asc' },
      take: limit,
      select: {
        sequence: true, prevHash: true, hash: true, tenantSlug: true, actorEmail: true,
        actorRole: true, action: true, entityType: true, entityId: true, patientId: true,
        before: true, after: true,
      },
    });

    let expectedPrev: string | null = null;

    for (const row of rows) {
      if (row.prevHash !== expectedPrev) {
        return { ok: false, brokenAtSequence: row.sequence.toString() };
      }

      const recomputed: string = chainHash({
        sequence: row.sequence.toString(),
        prevHash: row.prevHash,
        tenantSlug: row.tenantSlug,
        actorEmail: row.actorEmail,
        actorRole: row.actorRole,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        patientId: row.patientId,
        before: row.before ?? null,
        after: row.after ?? null,
      });

      if (recomputed !== row.hash) {
        return { ok: false, brokenAtSequence: row.sequence.toString() };
      }
      expectedPrev = row.hash;
    }

    return { ok: true };
  }
}
