import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PatientsModule } from '../patients/patients.module';
import { PractitionersModule } from '../practitioners/practitioners.module';
import { PartnerController } from './partner.controller';
import { IntakeService } from './intake.service';
import { VisitPhotosService } from './visit-photos.service';
import { QuestionnaireService } from './questionnaire.service';
import { ExternalVisitService } from './external-visit.service';
import { ExternalFetchService } from './external-fetch.service';

/**
 * Bounded context: the partner API.
 *
 * The product surface. It owns no tables of its own — it composes the other
 * contexts behind a stable external contract, which is exactly the seam to cut
 * along if this ever needs to scale separately from the rest.
 */
@Module({
  imports: [TenancyModule, PatientsModule, PractitionersModule],
  controllers: [PartnerController],
  providers: [
    IntakeService,
    VisitPhotosService,
    QuestionnaireService,
    ExternalVisitService,
    ExternalFetchService,
  ],
})
export class PartnerApiModule {}
