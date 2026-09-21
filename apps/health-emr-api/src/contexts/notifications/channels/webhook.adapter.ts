import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeliveryResult, NotificationChannelAdapter, OutboundMessage } from './channel.interface';

/**
 * Outbound webhook to a tenant's own backend.
 *
 * This one may carry detail: the tenant is a business associate under contract,
 * and the transport is server-to-server over TLS. Payloads are HMAC-signed so the
 * receiver can prove the call came from us and was not replayed — the mirror of
 * how Beluga signs its callbacks to JoeyMed today.
 */
@Injectable()
export class WebhookAdapter implements NotificationChannelAdapter {
  readonly channel = 'WEBHOOK' as const;
  readonly carriesPhi = true;
  readonly enabled = true;

  private readonly logger = new Logger(WebhookAdapter.name);

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const secret = String(message.metadata?.secret ?? '');
    const timestamp = Date.now().toString();
    const signature = WebhookAdapter.sign(secret, timestamp, message.body);

    try {
      const response = await fetch(message.target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HealthEMR-Timestamp': timestamp,
          'X-HealthEMR-Signature': signature,
        },
        body: message.body,
      });

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      return { ok: true, externalId: response.headers.get('x-request-id') ?? undefined };
    } catch (error) {
      this.logger.warn(`[webhook] ${message.target} failed: ${(error as Error).message}`);
      return { ok: false, error: (error as Error).message };
    }
  }

  /** Signs over the timestamp too, so a captured body cannot be replayed later. */
  static sign(secret: string, timestamp: string, body: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  /** For receivers, and for our own tests. Constant-time by construction. */
  static verify(secret: string, timestamp: string, body: string, presented: string): boolean {
    const expected = WebhookAdapter.sign(secret, timestamp, body);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(presented, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
