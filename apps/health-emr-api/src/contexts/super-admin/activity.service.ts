import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActivityEntry, ActivityQuery, ChainIntegrityReport } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { buildOrderBy, listResponse, offsetSkipTake, safeSort } from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';

export const ACTIVITY_SORT = ['createdAt', 'action'] as const;

/**
 * Filterable columns of the activity log, keyed by the column id.
 *
 * `summary` and `changes` are rendered from several fields at read time and so
 * have nothing to filter against; they get no box rather than a box that
 * silently does nothing.
 */
export const ACTIVITY_FILTERS = {
  // `action` likewise: the endpoint already accepts it.
  // The column shows a name. The email is kept searchable too, and is the
  // only thing left to search once the account itself has been deleted.
  actor: {
    path: 'actorEmail',
    kind: 'name',
    paths: ['actor.firstName', 'actor.lastName', 'actorEmail'],
  },
  tenant: { path: 'tenantSlug', kind: 'text' },
  entity: { path: 'entityType', kind: 'text' },
  ip: { path: 'ip', kind: 'text' },
  sequence: { path: 'sequence', kind: 'number' },
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

/**
 * Human-readable phrasing for each recorded action.
 *
 * The audit table stores an enum because enums are queryable; an operator
 * scanning a page of history needs a sentence. Rendering it here rather than in
 * the browser keeps the two from drifting, and means an exported CSV reads the
 * same as the screen.
 */
const PHRASING: Record<string, string> = {
  WEBHOOK_CHANGED: 'changed where events are sent for',
  LOGIN_SUCCESS: 'signed in',
  LOGIN_FAILED: 'failed to sign in',
  LOGOUT: 'signed out',
  REFRESH_TOKEN_ROTATED: 'refreshed a session',
  REFRESH_TOKEN_REVOKED: 'revoked a session',
  USER_CREATED: 'created an account for',
  USER_UPDATED: 'updated',
  USER_ROLE_CHANGED: 'changed the role of',
  USER_DEACTIVATED: 'deactivated',
  TENANT_CREATED: 'created the account',
  TENANT_UPDATED: 'updated',
  ENTITLEMENT_CHANGED: 'changed what is enabled for',
  PHI_READ: 'opened',
  PHI_CREATED: 'created',
  PHI_UPDATED: 'updated',
  PHI_DELETED: 'deleted',
  REQUEST_ROUTED: 'routed',
  REQUEST_DECIDED: 'decided',
  PRESCRIPTION_SIGNED: 'signed a prescription on',
  PRESCRIPTION_VOIDED: 'voided a prescription on',
  ORDER_SUBMITTED: 'sent to the pharmacy',
  ORDER_STATUS_CHANGED: 'moved',
  BREAK_THE_GLASS: 'opened a record outside their own account —',
  ADMIN_CREATED: 'created the client account',
  INVITE_SENT: 'invited',
  INVITE_ACCEPTED: 'accepted an invitation for',
  APPLICATION_DECIDED: 'decided the application for',
  ACCOUNT_SUSPENDED: 'suspended',
  ACCOUNT_REACTIVATED: 'reactivated',
  PROVIDER_REASSIGNED: 'reassigned',
};

/** Fields never worth showing in a diff, because they change on every write. */
const NOISE = new Set(['updatedAt', 'createdAt', 'id']);

/**
 * The accountability surface.
 *
 * Every privileged action in the platform already writes a hash-chained audit
 * row; until it can be read, that is a promise rather than a control. This turns
 * the chain into something an operator — or an auditor — can actually search,
 * and exposes the verification result rather than assuming it.
 *
 * Reads here are not themselves break-the-glass: the log records *who touched
 * what*, and its `before`/`after` payloads are deliberately kept free of
 * clinical detail by the services that write them.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ActivityQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action as Prisma.AuditLogWhereInput['action'] } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...columnFilterWhere(query, ACTIVITY_FILTERS),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      // Free-text search runs over the entity reference rather than the payload:
      // `before`/`after` are jsonb, and an unindexed jsonb scan over a six-year
      // trail is a table scan by another name.
      ...(query.q
        ? {
            OR: [
              { entityType: { contains: query.q, mode: 'insensitive' } },
              { entityId: { contains: query.q, mode: 'insensitive' } },
              { actorEmail: { contains: query.q, mode: 'insensitive' } },
              { actor: { lastName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const sort = safeSort(query.sort, ACTIVITY_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.auditLog.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        select: {
          id: true, sequence: true, action: true, entityType: true, entityId: true,
          patientId: true, before: true, after: true, ip: true, requestId: true, createdAt: true,
          actorEmail: true, actorRole: true,
          actor: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
          tenant: { select: { id: true, name: true } },
        },
      }),
      this.prisma.raw.auditLog.count({ where }),
    ]);

    const data: ActivityEntry[] = rows.map((row) => this.present(row));
    return listResponse(data, total, query, ACTIVITY_SORT);
  }

  /** Everything that ever happened to one record — the per-profile history tab. */
  async forEntity(entityType: string, entityId: string, take = 50): Promise<ActivityEntry[]> {
    const rows = await this.prisma.raw.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { sequence: 'desc' },
      take,
      select: {
        id: true, sequence: true, action: true, entityType: true, entityId: true,
        patientId: true, before: true, after: true, ip: true, requestId: true, createdAt: true,
        actorEmail: true, actorRole: true,
        actor: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        tenant: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * Reports whether the chain still verifies.
   *
   * Surfaced in the console rather than left to a cron job's log, because the
   * value of tamper evidence is that somebody sees it. A `false` here means a
   * row was edited or removed in the database directly.
   */
  async integrity(): Promise<ChainIntegrityReport> {
    const [result, checked, first, last] = await Promise.all([
      this.audit.verifyChain(),
      // How many entries the verification covered.
      this.prisma.raw.auditLog.count(),
      this.prisma.raw.auditLog.findFirst({ orderBy: { sequence: 'asc' }, select: { createdAt: true } }),
      this.prisma.raw.auditLog.findFirst({ orderBy: { sequence: 'desc' }, select: { createdAt: true } }),
    ]);

    return {
      checked,
      intact: result.ok,
      brokenAtSequence: result.brokenAtSequence ?? null,
      reason: result.ok
        ? null
        : `Entry ${result.brokenAtSequence} does not reconcile with the entry before it. ` +
          'Either its contents were changed or a preceding entry was removed.',
      firstEntryAt: first?.createdAt.toISOString() ?? null,
      lastEntryAt: last?.createdAt.toISOString() ?? null,
    };
  }

  private present(row: {
    id: string;
    sequence: bigint;
    action: string;
    entityType: string;
    entityId: string | null;
    patientId: string | null;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
    ip: string | null;
    requestId: string | null;
    createdAt: Date;
    actorEmail: string | null;
    actorRole: string | null;
    actor: { id: string; firstName: string; lastName: string; email: string; role: string } | null;
    tenant: { id: string; name: string } | null;
  }): ActivityEntry {
    // The account may since have been removed. The frozen email is what keeps
    // the entry attributable when it has.
    const actorName = row.actor
      ? `${row.actor.firstName} ${row.actor.lastName}`.trim()
      : (row.actorEmail ?? 'The system');
    const verb = PHRASING[row.action] ?? row.action.toLowerCase().replace(/_/g, ' ');
    const target = this.describeTarget(row);

    return {
      id: row.id,
      sequence: row.sequence.toString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: `${actorName} ${verb} ${target}`.trim(),
      actor:
        row.actor || row.actorEmail
          ? {
              id: row.actor?.id ?? '',
              name: actorName,
              email: row.actor?.email ?? row.actorEmail ?? '',
              role: row.actor?.role ?? row.actorRole ?? 'UNKNOWN',
            }
          : null,
      tenant: row.tenant,
      patientId: row.patientId,
      changes: this.diff(row.before, row.after),
      ip: row.ip,
      requestId: row.requestId,
      at: row.createdAt.toISOString(),
    };
  }

  /**
   * Names the thing acted on, preferring a name the writer recorded over an id.
   * An operator cannot recognise a uuid, and asking them to look one up defeats
   * the point of a readable trail.
   */
  private describeTarget(row: { entityType: string; entityId: string | null; after: Prisma.JsonValue; before: Prisma.JsonValue }): string {
    const payload = (row.after ?? row.before) as Record<string, unknown> | null;
    const named =
      payload && typeof payload === 'object'
        ? (payload.name ?? payload.legalName ?? payload.displayName ?? payload.email ?? payload.number)
        : null;

    const label = row.entityType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (typeof named === 'string' && named) return `${label} ${named}`;
    return row.entityId ? `${label} ${row.entityId.slice(0, 8)}` : label;
  }

  /** Field-level changes, so "updated" says what actually moved. */
  private diff(
    before: Prisma.JsonValue,
    after: Prisma.JsonValue,
  ): Array<{ field: string; from: unknown; to: unknown }> | null {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return null;
    if (Array.isArray(before) || Array.isArray(after)) return null;

    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (NOISE.has(key)) continue;
      if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
      changes.push({ field: key, from: b[key] ?? null, to: a[key] ?? null });
    }

    return changes.length ? changes : null;
  }
}
