import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminClinicalService } from './admin-clinical.service';
// Provided here rather than imported from the super-admin module: the service is
// stateless and takes a tenant id, so a client business reading its own spend and
// the platform reading everyone's are the same query with a different scope.
// Importing that module wholesale would drag the whole platform surface in with
// it for the sake of one class.
import { RevenueService } from '../super-admin/revenue.service';
import { TenancyModule } from '../tenancy/tenancy.module';

/**
 * Bounded context: admin.
 *
 * The tenant-facing console for a telehealth business.
 */
@Module({
  imports: [TenancyModule],
  controllers: [AdminController],
  providers: [AdminService, AdminClinicalService, RevenueService],
  exports: [AdminService, AdminClinicalService],
})
export class AdminModule {}
