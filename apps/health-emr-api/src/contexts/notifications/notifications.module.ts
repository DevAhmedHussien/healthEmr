import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EmailAdapter } from './channels/email.adapter';
import { SmsAdapter } from './channels/sms.adapter';
import { WebhookAdapter } from './channels/webhook.adapter';

/**
 * Bounded context: notifications.
 *
 * Global because every other context needs to tell someone something, and a
 * notification is a cross-cutting concern rather than a domain of its own.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailAdapter, SmsAdapter, WebhookAdapter],
  exports: [NotificationsService],
})
export class NotificationsModule {}
