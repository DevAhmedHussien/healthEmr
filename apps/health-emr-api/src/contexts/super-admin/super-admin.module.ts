import { Module } from '@nestjs/common';
import { WebhooksModule } from '@/contexts/webhooks/webhooks.module';
import { SuperAdminController } from './super-admin.controller';
import { GovernanceController } from './governance.controller';
import { OverviewService } from './overview.service';
import { RevenueService } from './revenue.service';
import { DirectoryService } from './directory.service';
import { AccountsService } from './accounts.service';
import { ClinicalService } from './clinical.service';
import { ActivityService } from './activity.service';
import { PractitionersModule } from '@/contexts/practitioners/practitioners.module';
import { GovernanceService } from './governance.service';
import { IdentityModule } from '@/contexts/identity/identity.module';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';
import { PermanentDeleteService } from './permanent-delete.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { TenantProfileService } from './tenant-profile.service';
import { BillingService } from './billing.service';
import { StuckOrderService } from './stuck-orders.service';
import { VisitVoidService } from './visit-void.service';
import { PharmacyModule } from '@/contexts/pharmacy/pharmacy.module';
import { TenancyModule } from '@/contexts/tenancy/tenancy.module';

/**
 * Bounded context: the platform owner's console.
 *
 * Reads across every tenant, which is exactly why it is one place with one role
 * guard rather than flags scattered through the tenant-facing contexts. The
 * read surface and the write surface are separate controllers: everything on
 * the second changes state and records who changed it.
 */
@Module({
  imports: [
    PharmacyModule,
    TenancyModule,
    WebhooksModule,
    PractitionersModule,
    IdentityModule,
  ],
  controllers: [SuperAdminController, GovernanceController, OwnerController],
  providers: [
    OverviewService,
    RevenueService,
    DirectoryService,
    AccountsService,
    ClinicalService,
    ActivityService,
    GovernanceService,
    OwnerService,
    PermanentDeleteService,
    ClinicalRecordsService,
    TenantProfileService,
    BillingService,
    StuckOrderService,
    VisitVoidService,
  ],
  exports: [
    OverviewService,
    RevenueService,
    DirectoryService,
    AccountsService,
    ClinicalService,
    ActivityService,
    GovernanceService,
    TenantProfileService,
    BillingService,
  ],
})
export class SuperAdminModule {}
