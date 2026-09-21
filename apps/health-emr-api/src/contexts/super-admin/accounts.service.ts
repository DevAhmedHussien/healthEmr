import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ListQuery } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { NotificationsService } from '@/contexts/notifications/notifications.service';
import {
  buildOrderBy,
  listResponse,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';

export const ADMIN_SORT = ['name', 'slug', 'createdAt', 'status'] as const;

/** Filterable columns of the client-business table, keyed by the column id. */
export const ADMIN_FILTERS = {
  name: { path: 'name', kind: 'text' },
  owner: { path: 'ownerName', kind: 'text' },
  email: { path: 'contactEmail', kind: 'text' },
  phone: { path: 'contactPhone', kind: 'text' },
  slug: { path: 'slug', kind: 'text' },
  patients: { path: 'patients', kind: 'presence' },
  providers: { path: 'providers', kind: 'presence' },
  pharmacies: { path: 'pharmacies', kind: 'presence' },
  // `status` is deliberately absent: the endpoint already takes it as a
  // validated enum, and redeclaring it here as loose text would replace that
  // check with none.
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

interface TenantStatRow {
  tenantId: string;
  patients: bigint;
  providers: bigint;
  pharmacies: bigint;
  ordersThisMonth: bigint;
  lastActivity: Date | null;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async listAdmins(query: ListQuery & { status?: string }) {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(searchAcross(query.q, ['name', 'slug', 'contactEmail', 'ownerName']) ?? {}),
      ...columnFilterWhere(query, ADMIN_FILTERS),
    };

    const sort = safeSort(query.sort, ADMIN_SORT, 'name');

    const [rows, total] = await Promise.all([
      this.prisma.raw.tenant.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        select: {
          id: true, slug: true, name: true, ownerName: true, contactEmail: true,
          contactPhone: true, status: true, createdAt: true,
          users: {
            where: { role: 'ADMIN' },
            select: { id: true, email: true, isEmailVerified: true, lastLoginAt: true },
            take: 1,
          },
        },
      }),
      this.prisma.raw.tenant.count({ where }),
    ]);

    const stats = await this.tenantStats(rows.map((row) => row.id));

    const data = rows.map((row) => {
      const stat = stats.get(row.id);
      const owner = row.users[0];
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        ownerName: row.ownerName,
        email: row.contactEmail,
        phone: row.contactPhone,
        status: row.status,
        patients: Number(stat?.patients ?? 0),
        providers: Number(stat?.providers ?? 0),
        pharmacies: Number(stat?.pharmacies ?? 0),
        ordersThisMonth: Number(stat?.ordersThisMonth ?? 0),
        lastActivity: stat?.lastActivity ?? null,
        /** An owner who has never signed in still has an invite outstanding. */
        inviteOutstanding: Boolean(owner && !owner.isEmailVerified),
        ownerUserId: owner?.id ?? null,
        createdAt: row.createdAt,
      };
    });

    return listResponse(data, total, query, ADMIN_SORT);
  }

  /** One grouped query covering every count on the page. */
  private async tenantStats(ids: string[]): Promise<Map<string, TenantStatRow>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.raw.$queryRaw<TenantStatRow[]>`
      SELECT
        t.id AS "tenantId",
        (SELECT COUNT(*) FROM tenant_patients tp  WHERE tp."tenantId"  = t.id) AS "patients",
        (SELECT COUNT(*) FROM tenant_providers pr WHERE pr."tenantId"  = t.id
                                               AND pr."endedAt" IS NULL)       AS "providers",
        (SELECT COUNT(*) FROM tenant_pharmacies ph WHERE ph."tenantId" = t.id) AS "pharmacies",
        (SELECT COUNT(*) FROM pharmacy_orders o   WHERE o."tenantId"   = t.id
                              AND o."createdAt" >= date_trunc('month', now())) AS "ordersThisMonth",
        (SELECT MAX(r."createdAt") FROM prescription_requests r
                                   WHERE r."tenantId" = t.id)                  AS "lastActivity"
      FROM tenants t
      WHERE t.id = ANY(${ids}::uuid[])
    `;
    return new Map(rows.map((row) => [row.tenantId, row]));
  }

  /**
   * Creates a telehealth business and its owner account.
   *
   * The owner is created without a usable password and invited to set their own.
   * Nobody — including the Super Admin who created them — ever knows a password
   * that works, which is what keeps "who did this" answerable in the audit log.
   */
  async createAdmin(
    input: {
      businessName: string;
      ownerName: string;
      email: string;
      phone?: string;
      categorySlugs?: string[];
    },
    actorUserId: string,
  ) {
    const email = input.email.trim().toLowerCase();
    const slug = await this.uniqueSlug(input.businessName);

    const existingUser = await this.prisma.raw.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException(`${email} already has an account`);
    }

    const { tenantId, userId, token } = await this.prisma.raw.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: input.businessName.trim(),
          ownerName: input.ownerName.trim(),
          contactEmail: email,
          contactPhone: input.phone?.trim() || null,
        },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: {
          email,
          // Random and discarded. The invite is the only way in.
          passwordHash: await argon2.hash(randomBytes(32).toString('base64'), {
            type: argon2.argon2id,
          }),
          role: 'ADMIN',
          tenantId: tenant.id,
          firstName: input.ownerName.trim().split(' ')[0] ?? input.ownerName,
          lastName: input.ownerName.trim().split(' ').slice(1).join(' ') || '—',
          phone: input.phone?.trim() || null,
          isEmailVerified: false,
          isActive: true,
        },
        select: { id: true },
      });

      const plain = randomBytes(32).toString('base64url');
      await tx.userInvite.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(plain).digest('hex'),
          invitedByUserId: actorUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          lastSentAt: new Date(),
          resendCount: 0,
        },
      });

      if (input.categorySlugs?.length) {
        const categories = await tx.category.findMany({
          where: { slug: { in: input.categorySlugs } },
          select: { id: true },
        });
        if (categories.length) {
          await tx.tenantCategory.createMany({
            data: categories.map((category) => ({ tenantId: tenant.id, categoryId: category.id })),
            skipDuplicates: true,
          });
        }
      }

      return { tenantId: tenant.id, userId: user.id, token: plain };
    });

    await this.audit.record({
      action: 'ADMIN_CREATED',
      entityType: 'Tenant',
      entityId: tenantId,
      actorUserId,
      after: { slug, name: input.businessName, ownerEmail: email },
    });

    await this.sendInvite(userId, tenantId, token);

    return { tenantId, slug, ownerUserId: userId };
  }

  async resendInvite(tenantId: string, actorUserId: string) {
    const owner = await this.prisma.raw.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
      select: { id: true, isEmailVerified: true },
    });
    if (!owner) throw new NotFoundException('This account has no owner to invite');
    if (owner.isEmailVerified) {
      throw new ConflictException('This owner has already accepted their invite');
    }

    const plain = randomBytes(32).toString('base64url');

    await this.prisma.raw.$transaction([
      // Retire any outstanding invite, so an old link cannot still be used.
      this.prisma.raw.userInvite.updateMany({
        where: { userId: owner.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.raw.userInvite.create({
        data: {
          userId: owner.id,
          tokenHash: createHash('sha256').update(plain).digest('hex'),
          invitedByUserId: actorUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          lastSentAt: new Date(),
          resendCount: 1,
        },
      }),
    ]);

    await this.audit.record({
      action: 'INVITE_SENT',
      entityType: 'User',
      entityId: owner.id,
      actorUserId,
      tenantId,
      after: { resent: true },
    });

    await this.sendInvite(owner.id, tenantId, plain);
    return { sent: true };
  }

  private async sendInvite(userId: string, tenantId: string, token: string) {
    await this.notifications.notify({
      userId,
      tenantId,
      kind: 'account.invite',
      title: 'Set up your HealthEMR account',
      body: `Use this link to set your password: /accept-invite?token=${token}`,
      // No credential in an unencrypted channel — the email says only that an
      // invitation exists.
      safeTitle: 'You have been invited to HealthEMR',
      safeBody: 'An account has been created for you. Check your inbox for the secure link.',
      link: `/accept-invite?token=${token}`,
      entityType: 'UserInvite',
      channels: ['IN_APP', 'EMAIL'],
    });
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'tenant';

    let slug = base;
    for (let attempt = 2; ; attempt += 1) {
      const clash = await this.prisma.raw.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (!clash) return slug;
      slug = `${base}-${attempt}`;
    }
  }

  /** Suspending or reactivating a provider, pharmacy or tenant. */
  async setStatus(
    kind: 'provider' | 'pharmacy' | 'tenant',
    id: string,
    suspend: boolean,
    reason: string | undefined,
    actorUserId: string,
  ) {
    const data = suspend
      ? { status: 'SUSPENDED' as const, suspendedAt: new Date(), suspendedReason: reason ?? null, suspendedByUserId: actorUserId }
      : { status: 'ACTIVE' as const, suspendedAt: null, suspendedReason: null, suspendedByUserId: null };

    if (kind === 'provider') {
      await this.prisma.raw.providerProfile.update({
        where: { id },
        // A suspended provider must also stop being routed work.
        data: { ...data, ...(suspend ? { isAcceptingRequests: false } : {}) },
      });
    } else if (kind === 'pharmacy') {
      await this.prisma.raw.pharmacy.update({
        where: { id },
        data: { ...data, isActive: !suspend },
      });
    } else {
      await this.prisma.raw.tenant.update({
        where: { id },
        data: { status: suspend ? 'SUSPENDED' : 'ACTIVE' },
      });
    }

    await this.audit.record({
      action: suspend ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
      entityType: kind,
      entityId: id,
      actorUserId,
      after: { reason: reason ?? null },
    });

    return { id, status: suspend ? 'SUSPENDED' : 'ACTIVE' };
  }
}
