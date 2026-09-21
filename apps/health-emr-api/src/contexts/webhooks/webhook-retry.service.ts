import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { WebhookBody } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';
import { WEBHOOK_FAILURE_LIMIT, nextRetryAt, postWebhook } from './webhook-sender';

/** Attempts before a delivery is abandoned and left for somebody to look at. */
const MAX_ATTEMPTS = 8;

/**
 * Sends again what did not get through.
 *
 * A client's endpoint being down for ten minutes should not cost them ten
 * minutes of visit history — their CRM would be permanently wrong about
 * patients nobody knows to go back and check. Failed deliveries are kept with
 * the body that was meant for them and retried on a widening backoff.
 */
@Injectable()
export class WebhookRetryService {
  private readonly logger = new Logger(WebhookRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async retryDue(): Promise<void> {
    const due = await runWithoutTenantScope(() =>
      this.prisma.raw.webhookDelivery.findMany({
        where: {
          deliveredAt: null,
          nextRetryAt: { not: null, lte: new Date() },
          attempts: { lt: MAX_ATTEMPTS },
          // An endpoint the platform switched off is not retried: it failed
          // twenty times in a row, and posting patient information at an
          // address that may no longer belong to them is the risk being avoided.
          webhook: { isActive: true, disabledAt: null },
        },
        take: 100,
        orderBy: { nextRetryAt: 'asc' },
        include: { webhook: true },
      }),
    );

    for (const delivery of due) {
      const attempt = await postWebhook(
        delivery.webhook.url,
        delivery.payload as unknown as WebhookBody,
        {
          bearer: this.phi.decrypt(delivery.webhook.authCipher),
          signingSecret: delivery.webhook.secretRef,
        },
      );

      const now = new Date();
      const attempts = delivery.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS || !attempt.retryable;

      await runWithoutTenantScope(async () => {
        await this.prisma.raw.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            responseStatus: attempt.status || null,
            responseBody: attempt.responseBody,
            lastError: attempt.error,
            deliveredAt: attempt.ok ? now : null,
            // Cleared when we stop: a row with no next attempt is the queue's
            // way of saying a person has to look at this one.
            nextRetryAt: attempt.ok || exhausted ? null : nextRetryAt(attempts, now),
          },
        });

        const failures = attempt.ok ? 0 : delivery.webhook.failureCount + 1;

        await this.prisma.raw.tenantWebhook.update({
          where: { id: delivery.webhookId },
          data: {
            lastAttemptAt: now,
            failureCount: failures,
            ...(attempt.ok
              ? { lastSuccessAt: now, lastError: null }
              : { lastError: attempt.error }),
            ...(failures >= WEBHOOK_FAILURE_LIMIT
              ? {
                  disabledAt: now,
                  disabledReason: `Switched off after ${failures} consecutive failures. Last: ${attempt.error ?? 'unknown'}`,
                }
              : {}),
          },
        });
      });
    }

    if (due.length) {
      this.logger.log(`Retried ${due.length} webhook ${due.length === 1 ? 'delivery' : 'deliveries'}`);
    }
  }
}
