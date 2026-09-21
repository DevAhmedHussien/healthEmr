import { Module } from '@nestjs/common';
import { PharmacyCatalogController } from './pharmacy-catalog.controller';
import { DispensaryCatalogController } from './dispensary-catalog.controller';
import { PharmacyCatalogService } from './pharmacy-catalog.service';
import { MedicationCatalogueController } from './medication-catalogue.controller';
import { FulfilmentController } from './fulfilment.controller';
import { FulfilmentService } from './fulfilment.service';
import { DispatchService } from './dispatch.service';
import { LifeFileService } from './lifefile/lifefile.service';
import { PharmacyCredentialResolver } from './lifefile/credentials';
import { IntegrationController } from './integration.controller';
import { DispensaryProfileController } from './dispensary-profile.controller';
import { RerouteService } from './reroute.service';

/**
 * Bounded context: pharmacy.
 *
 * Owns pharmacies, their catalogues, the dispatch of signed prescriptions into
 * an order, and the fulfilment of that order through to a tracking number.
 */
@Module({
  controllers: [PharmacyCatalogController, DispensaryCatalogController, FulfilmentController, IntegrationController, DispensaryProfileController, MedicationCatalogueController],
  providers: [PharmacyCatalogService, FulfilmentService, DispatchService, LifeFileService, PharmacyCredentialResolver, RerouteService],
  exports: [PharmacyCatalogService, FulfilmentService, DispatchService, LifeFileService, RerouteService],
})
export class PharmacyModule {}
