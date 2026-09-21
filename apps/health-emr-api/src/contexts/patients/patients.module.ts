import { Module } from '@nestjs/common';
import { PatientIdentityService } from './patient-identity.service';
import { PatientPortalService } from './patient-portal.service';
import { PatientPortalController } from './patient-portal.controller';

/**
 * Bounded context: patients.
 *
 * Owns the person, the chart, who may look at it, and the patient's own view.
 */
@Module({
  controllers: [PatientPortalController],
  providers: [PatientIdentityService, PatientPortalService],
  exports: [PatientIdentityService],
})
export class PatientsModule {}
