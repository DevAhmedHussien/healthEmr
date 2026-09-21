import { Module } from '@nestjs/common';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookAdminService } from './webhook-admin.service';
import { WebhookRetryService } from './webhook-retry.service';

/**
 * Bounded context: telling a client business what happened.
 *
 * It owns no clinical logic and reads no other context's tables through their
 * services — it subscribes to the event bus and posts what it hears. That is
 * what lets a client's endpoint be slow, or down, without any of it reaching a
 * clinician signing a prescription.
 */
@Module({
  providers: [WebhookDispatcher, WebhookAdminService, WebhookRetryService],
  exports: [WebhookAdminService],
})
export class WebhooksModule {}
