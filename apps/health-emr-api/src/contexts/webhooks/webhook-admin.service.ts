import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateWebhookInput, UpdateWebhookInput, Role } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';
import { newSigningSecret, postWebhook } from './webhook-sender';

interface Actor {
  id: string;
  role: Role;
}

/**
 * Managing where a client business is told things.
 *
 * Only the platform owner may write here, and that is a deliberate asymmetry.
 * The endpoint receives patient information, so pointing it somewhere new is a
 * disclosure decision — not a preference a client changes for itself. A client
 * can read its own endpoints, minus the credential.
 */
@Injectable()
export class WebhookAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Never returns the bearer token.
   *
   * It belongs to the client and we hold it only to present it back to their
   * endpoint. A console that could show it would turn every operator with
   * access into a way to extract it; replacing it is the supported operation.
   */
  async list(tenantId: string) {
    const rows = await runWithoutTenantScope(() =>
      this.prisma.raw.tenantWebhook.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { deliveries: true } },
          deliveries: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { event: true, responseStatus: true, deliveredAt: true, createdAt: true },
          },
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      events: row.events,
      isActive: row.isActive,
      /** True when the platform stopped trying. `disabledReason` says why. */
      disabled: row.disabledAt !== null,
      disabledReason: row.disabledReason,
      failureCount: row.failureCount,
      lastAttemptAt: row.lastAttemptAt,
      lastSuccessAt: row.lastSuccessAt,
      lastError: row.lastError,
      deliveries: row._count.deliveries,
      lastDelivery: row.deliveries[0] ?? null,
      createdAt: row.createdAt,
      /** Enough to confirm a credential is set, without disclosing it. */
      hasAuthToken: row.authCipher.length > 0,
    }));
  }

  async create(tenantId: string, input: CreateWebhookInput, actor: Actor) {
    const tenant = await runWithoutTenantScope(() =>
      this.prisma.raw.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
    );
    if (!tenant) throw new NotFoundException('That client account does not exist');

    // The same URL twice would post every event twice, which reads at the far
    // end as a duplicate visit rather than as our mistake.
    const clash = await runWithoutTenantScope(() =>
      this.prisma.raw.tenantWebhook.findFirst({
        where: { tenantId, url: input.url },
        select: { id: true },
      }),
    );
    if (clash) throw new BadRequestException('That URL is already registered for this account');

    const signingSecret = newSigningSecret();

    const created = await runWithoutTenantScope(() =>
      this.prisma.raw.tenantWebhook.create({
        data: {
          tenantId,
          name: input.name,
          url: input.url,
          authCipher: this.phi.encrypt(input.authToken),
          secretRef: signingSecret,
          events: input.events,
          isActive: input.isActive,
        },
        select: { id: true, name: true, url: true, events: true, isActive: true },
      }),
    );

    await this.audit.record({
      action: 'WEBHOOK_CHANGED',
      entityType: 'TenantWebhook',
      entityId: created.id,
      tenantId,
      tenantSlug: tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      // The URL and the events, never the token.
      after: { created: created.url, events: created.events, name: created.name },
    });

    return {
      ...created,
      /**
       * Shown once, here, and never again.
       *
       * The client needs it to verify our signature. We keep it to sign with,
       * but there is no reason to serve it back afterwards — and every reason
       * not to.
       */
      signingSecret,
    };
  }

  async update(webhookId: string, input: UpdateWebhookInput, actor: Actor) {
    const existing = await this.find(webhookId);

    const updated = await runWithoutTenantScope(() =>
      this.prisma.raw.tenantWebhook.update({
        where: { id: webhookId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.url ? { url: input.url } : {}),
          ...(input.events ? { events: input.events } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          // Sending no token leaves the stored one alone, so an operator can
          // edit the event list without having to re-enter a credential they
          // may not have to hand.
          ...(input.authToken ? { authCipher: this.phi.encrypt(input.authToken) } : {}),
          // Any deliberate edit is a statement that somebody is looking after
          // this endpoint again, so the platform starts trying it once more.
          ...(existing.disabledAt
            ? { disabledAt: null, disabledReason: null, failureCount: 0 }
            : {}),
        },
        select: { id: true, name: true, url: true, events: true, isActive: true },
      }),
    );

    await this.audit.record({
      action: 'WEBHOOK_CHANGED',
      entityType: 'TenantWebhook',
      entityId: webhookId,
      tenantId: existing.tenantId,
      tenantSlug: existing.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before: { url: existing.url, events: existing.events, isActive: existing.isActive },
      after: {
        url: updated.url,
        events: updated.events,
        isActive: updated.isActive,
        // Recorded as a fact, not a value.
        credentialReplaced: Boolean(input.authToken),
      },
    });

    return updated;
  }

  async remove(webhookId: string, actor: Actor) {
    const existing = await this.find(webhookId);

    // Deliveries cascade with it. They are a record of what we sent this
    // endpoint, and once the endpoint is gone there is nothing they document
    // that the visit's own audit trail does not.
    await runWithoutTenantScope(() =>
      this.prisma.raw.tenantWebhook.delete({ where: { id: webhookId } }),
    );

    await this.audit.record({
      action: 'WEBHOOK_CHANGED',
      entityType: 'TenantWebhook',
      entityId: webhookId,
      tenantId: existing.tenantId,
      tenantSlug: existing.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before: { url: existing.url, events: existing.events },
      after: { removed: true },
    });

    return { id: webhookId, removed: true };
  }

  /**
   * Posts a harmless event to the endpoint and reports what came back.
   *
   * Carries no patient information: the point is to prove the URL, the
   * credential and the signature work, and doing that with a real patient's
   * details would disclose them to whatever the URL turns out to be.
   */
  async test(webhookId: string, actor: Actor) {
    const endpoint = await this.find(webhookId);

    const attempt = await postWebhook(
      endpoint.url,
      {
        masterId: 'TEST-0000',
        event: 'CONSULT_RECEIVED',
        occurredAt: new Date().toISOString(),
      },
      { bearer: this.phi.decrypt(endpoint.authCipher), signingSecret: endpoint.secretRef },
    );

    await this.audit.record({
      action: 'WEBHOOK_CHANGED',
      entityType: 'TenantWebhook',
      entityId: webhookId,
      tenantId: endpoint.tenantId,
      tenantSlug: endpoint.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      after: { tested: endpoint.url, status: attempt.status, ok: attempt.ok },
    });

    return {
      ok: attempt.ok,
      status: attempt.status,
      error: attempt.error,
      responseBody: attempt.responseBody,
    };
  }

  /** What we sent this endpoint, most recent first. */
  async deliveries(webhookId: string, limit = 50) {
    await this.find(webhookId);

    return runWithoutTenantScope(() =>
      this.prisma.raw.webhookDelivery.findMany({
        where: { webhookId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        select: {
          id: true,
          event: true,
          payload: true,
          responseStatus: true,
          responseBody: true,
          lastError: true,
          attempts: true,
          deliveredAt: true,
          nextRetryAt: true,
          createdAt: true,
          requestId: true,
        },
      }),
    );
  }

  private async find(webhookId: string) {
    const endpoint = await runWithoutTenantScope(() =>
      this.prisma.raw.tenantWebhook.findUnique({
        where: { id: webhookId },
        include: { tenant: { select: { slug: true } } },
      }),
    );
    if (!endpoint) throw new NotFoundException('That webhook does not exist');
    return endpoint;
  }
}
