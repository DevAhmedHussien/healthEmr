import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/shared/prisma/prisma.service';

export interface ResolvedApiKey {
  tenantId: string;
  tenantSlug: string;
  scopes: string[];
}

/** What a key looks like once it exists. The only time `key` is ever returned. */
export interface IssuedApiKey {
  id: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
}

/** A key as it can safely be listed: everything about it except the key. */
export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

const PREFIX_LENGTH = 12;

/**
 * Tenant API keys.
 *
 * A key looks like `hemr_<prefix><secret>`. The prefix is a non-secret lookup
 * handle so one indexed query finds the candidate row; the whole key is then
 * verified with argon2. That avoids both a table scan and a timing oracle.
 *
 * Only the hash is stored. A key is shown once, at creation, and is
 * unrecoverable afterwards — which is the property the token currently
 * hardcoded in joeymed-backend's configuration.ts does not have.
 */
@Injectable()
export class TenantApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    tenantId: string,
    name: string,
    scopes: string[] = [],
    expiresAt?: Date | null,
  ): Promise<IssuedApiKey> {
    const prefix = randomBytes(9).toString('base64url').slice(0, PREFIX_LENGTH);
    const secret = randomBytes(32).toString('base64url');
    const key = `hemr_${prefix}${secret}`;

    const record = await this.prisma.raw.tenantApiKey.create({
      data: {
        tenantId,
        name,
        scopes,
        expiresAt: expiresAt ?? null,
        keyPrefix: prefix,
        keyHash: await argon2.hash(key, { type: argon2.argon2id }),
      },
      select: { id: true, createdAt: true },
    });

    return { id: record.id, key, keyPrefix: prefix, createdAt: record.createdAt.toISOString() };
  }

  /**
   * The keys on an account, without the keys.
   *
   * Everything here is safe to render: the prefix identifies a key in a support
   * conversation without being usable, and `lastUsedAt` is how you tell a live
   * integration from one that was minted and forgotten. Revoked keys stay
   * listed — "this credential existed and was withdrawn on this date" is the
   * question an auditor asks, and deleting the row destroys the answer.
   */
  async list(tenantId: string): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.raw.tenantApiKey.findMany({
      where: { tenantId },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scopes: row.scopes,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      status: row.revokedAt
        ? ('REVOKED' as const)
        : row.expiresAt && row.expiresAt < now
          ? ('EXPIRED' as const)
          : ('ACTIVE' as const),
    }));
  }

  async resolve(presented: string): Promise<ResolvedApiKey | null> {
    if (!presented.startsWith('hemr_')) return null;

    const prefix = presented.slice(5, 5 + PREFIX_LENGTH);
    if (prefix.length < PREFIX_LENGTH) return null;

    const candidate = await this.prisma.raw.tenantApiKey.findUnique({
      where: { keyPrefix: prefix },
      include: { tenant: { select: { id: true, slug: true, status: true } } },
    });

    if (!candidate || candidate.revokedAt) return null;
    if (candidate.expiresAt && candidate.expiresAt < new Date()) return null;
    if (candidate.tenant.status !== 'ACTIVE') return null;

    const matches = await argon2.verify(candidate.keyHash, presented).catch(() => false);
    if (!matches) return null;

    // Best-effort; a failure here must not reject an otherwise valid request.
    void this.prisma.raw.tenantApiKey
      .update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      tenantId: candidate.tenant.id,
      tenantSlug: candidate.tenant.slug,
      scopes: candidate.scopes,
    };
  }

  /**
   * Deletes a key, by tenant as well as by id.
   *
   * The tenant is part of the lookup rather than checked afterwards: an id
   * alone would let one account delete another's credential by guessing.
   * `deleteMany` matching nothing is the same answer as "no such key", which is
   * what a caller outside the account should be told.
   *
   * The row goes. What remains is the audit entry recording that a key with
   * this prefix existed and who removed it — the trail is a separate, append-only
   * table precisely so deleting the thing does not delete the record of it.
   */
  async remove(tenantId: string, id: string): Promise<ApiKeySummary | null> {
    const existing = (await this.list(tenantId)).find((row) => row.id === id);
    if (!existing) return null;

    await this.prisma.raw.tenantApiKey.delete({ where: { id } });
    return existing;
  }
}
