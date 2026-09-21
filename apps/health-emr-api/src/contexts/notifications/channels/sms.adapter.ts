import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryResult, NotificationChannelAdapter, OutboundMessage } from './channel.interface';

/**
 * SMS.
 *
 * Same posture as email, more so: a text arrives on a lock screen where anyone
 * standing nearby can read it. Content-free by default.
 */
@Injectable()
export class SmsAdapter implements NotificationChannelAdapter {
  readonly channel = 'SMS' as const;
  readonly carriesPhi = false;
  readonly enabled = true;

  private readonly logger = new Logger(SmsAdapter.name);

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    return this.transmit(message);
  }

  protected async transmit(message: OutboundMessage): Promise<DeliveryResult> {
    this.logger.log(`[sms] to=${maskPhone(message.target)} len=${message.body.length}`);
    return { ok: true, externalId: `dev-sms-${Date.now()}` };
  }
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : '***';
}
