import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryResult, NotificationChannelAdapter, OutboundMessage } from './channel.interface';

/**
 * Email.
 *
 * The driver is deliberately pluggable and defaults to logging, so the whole
 * notification path is exercisable in development and CI without credentials or
 * the risk of actually mailing a real address from a test run. Swap in SES or
 * SMTP by implementing `transmit` — nothing above this class changes.
 */
@Injectable()
export class EmailAdapter implements NotificationChannelAdapter {
  readonly channel = 'EMAIL' as const;
  /** Cleartext email is not a channel we control. */
  readonly carriesPhi = false;
  readonly enabled = true;

  private readonly logger = new Logger(EmailAdapter.name);

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    return this.transmit(message);
  }

  protected async transmit(message: OutboundMessage): Promise<DeliveryResult> {
    // Log only the target and subject. Logging the body would defeat the point
    // of keeping PHI out of the channel in the first place.
    this.logger.log(`[email] to=${maskEmail(message.target)} subject="${message.subject}"`);
    return { ok: true, externalId: `dev-email-${Date.now()}` };
  }
}

function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
