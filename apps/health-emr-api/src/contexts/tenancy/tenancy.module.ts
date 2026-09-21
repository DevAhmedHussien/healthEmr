import { Module } from '@nestjs/common';
import { TenantApiKeyService } from './tenant-api-key.service';
import { EntitlementsService } from './entitlements.service';
import { ApiAccessService } from './api-access.service';

/**
 * Bounded context: tenancy.
 *
 * Owns tenants, their API keys, their webhooks and their entitlements. Every
 * other context asks this one "may tenant X do Y" rather than reading the
 * tenant_* tables itself.
 */
@Module({
  providers: [TenantApiKeyService, EntitlementsService, ApiAccessService],
  exports: [TenantApiKeyService, EntitlementsService, ApiAccessService],
})
export class TenancyModule {}
