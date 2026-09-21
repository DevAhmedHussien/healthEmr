import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { TenantApiKeyService, type ApiKeySummary, type IssuedApiKey } from './tenant-api-key.service';

/** What a client business needs in front of them to wire up an integration. */
export interface ApiAccess {
  tenant: { id: string; slug: string; name: string; status: string };
  /** The value their backend must send as `company` on every visit. */
  companyKey: string;
  baseUrl: string;
  keys: ApiKeySummary[];
}

/**
 * Issuing and deleting the credentials a client business integrates with.
 *
 * The credential and the account are one thing, not two: a key resolves to
 * exactly one tenant, and intake refuses a visit whose `company` disagrees with
 * the key that carried it. So a key is the answer to "did this really come from
 * them" — which makes minting one a governance act, audited the same way
 * creating an account or suspending a provider is.
 *
 * The plaintext key exists for one HTTP response and is never written down,
 * here or in the audit trail. What the trail records is that a key with a given
 * prefix was issued to a named account by a named person.
 */
@Injectable()
export class ApiAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: TenantApiKeyService,
    private readonly audit: AuditService,
  ) {}

  async overview(tenantId: string): Promise<ApiAccess> {
    const tenant = await this.tenant(tenantId);

    return {
      tenant,
      companyKey: tenant.slug,
      baseUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
      keys: await this.keys.list(tenantId),
    };
  }

  async issue(
    tenantId: string,
    name: string,
    actor: AuthenticatedUser,
    expiresAt?: Date | null,
  ): Promise<IssuedApiKey & { companyKey: string }> {
    const tenant = await this.tenant(tenantId);
    const issued = await this.keys.issue(tenantId, name, [], expiresAt);

    await this.audit.record({
      action: 'API_KEY_ISSUED',
      entityType: 'TenantApiKey',
      entityId: issued.id,
      tenantId,
      tenantSlug: tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      // The prefix, never the key. Enough to tie a request in the logs back to
      // this row; useless to anyone who reads the trail.
      after: { name, keyPrefix: issued.keyPrefix, expiresAt: expiresAt?.toISOString() ?? null },
    });

    return { ...issued, companyKey: tenant.slug };
  }

  async remove(tenantId: string, keyId: string, actor: AuthenticatedUser): Promise<ApiKeySummary> {
    const tenant = await this.tenant(tenantId);
    const removed = await this.keys.remove(tenantId, keyId);
    if (!removed) throw new NotFoundException('That key does not exist');

    await this.audit.record({
      action: 'API_KEY_REVOKED',
      entityType: 'TenantApiKey',
      entityId: keyId,
      tenantId,
      tenantSlug: tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      // The row is gone, so the trail is the only place this key is now
      // recorded. It carries the prefix and the name, never the key.
      before: { name: removed.name, keyPrefix: removed.keyPrefix, lastUsedAt: removed.lastUsedAt },
      after: { deleted: true },
    });

    return removed;
  }

  private async tenant(tenantId: string) {
    const tenant = await this.prisma.raw.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!tenant) throw new NotFoundException('That client account does not exist');
    return tenant;
  }
}
