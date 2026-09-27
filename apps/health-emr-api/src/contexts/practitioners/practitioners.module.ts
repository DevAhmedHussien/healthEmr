import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RoutingService } from './routing.service';
import { ProviderLicencesService } from './provider-licences.service';
import { AssignmentRetryService } from './assignment-retry.service';
import { ManualAssignmentService } from './manual-assignment.service';
import { ProviderActivityService } from './provider-activity.service';
import { SignatureService } from './signature.service';

/**
 * Bounded context: practitioners.
 *
 * Owns provider profiles, per-state licensure, category qualification and the
 * routing engine that decides who may see a request.
 */
@Module({
  imports: [TenancyModule],
  providers: [
    RoutingService,
    ProviderLicencesService,
    AssignmentRetryService,
    ManualAssignmentService,
    ProviderActivityService,
    SignatureService,
  ],
  exports: [
    RoutingService,
    ProviderLicencesService,
    ManualAssignmentService,
    ProviderActivityService,
    SignatureService,
  ],
})
export class PractitionersModule {}
