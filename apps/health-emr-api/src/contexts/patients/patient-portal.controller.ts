import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiListOk, ApiStandardErrors, ApiZodOk } from '@/shared/http/api-docs';
import type { AuthenticatedUser } from '@health-emr/types';
import { Role } from '@health-emr/types';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { PatientPortalService } from './patient-portal.service';

/**
 * The patient's own view. No route here accepts a patient id — the chart is
 * always resolved from the session, so there is nothing to tamper with.
 */
const patientRecord = z.object({
  mrn: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string(),
  sexAtBirth: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.object({
    line1: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
  }),
  allergies: z.array(z.object({ substance: z.string(), severity: z.string() })),
  conditions: z.array(z.object({ display: z.string() })),
  medications: z.array(z.object({ nameText: z.string() })),
});

const patientVisit = z.object({
  visitId: z.string().uuid(),
  category: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  items: z.array(z.object({ nameText: z.string(), decision: z.string() })),
});

const patientPrescription = z.object({
  prescriptionId: z.string().uuid(),
  medication: z.string(),
  dose: z.string(),
  quantity: z.string(),
  refills: z.number().int(),
  directions: z.string(),
  status: z.string(),
  prescriber: z.string(),
  licenseNumber: z.string(),
  licenseState: z.string(),
});

@ApiTags('portal')
@Roles(Role.PATIENT)
@Controller({ path: 'portal', version: '1' })
export class PatientPortalController {
  constructor(private readonly portal: PatientPortalService) {}

  @Get('record')
  @ApiOperation({
    summary: 'My demographics, allergies, conditions and medications',
    description: 'The chart is resolved from the session. No route here accepts a patient id.',
  })
  @ApiZodOk(patientRecord)
  @ApiStandardErrors()
  record(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.record(user.id);
  }

  @Get('visits')
  @ApiOperation({
    summary: 'My questionnaire submissions and their outcomes',
    description:
      'Deliberately omits which provider is assigned and which business referred me — neither is ' +
      'the patient\'s business until a decision exists.',
  })
  @ApiListOk(patientVisit)
  @ApiStandardErrors()
  async visits(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.portal.visits(user.id) };
  }

  @Get('prescriptions')
  @ApiOperation({
    summary: 'My prescriptions and their shipment status',
    description:
      'Each prescription carries the prescriber name and licence as recorded at the moment of ' +
      'signature, plus the latest shipment for that order.',
  })
  @ApiListOk(patientPrescription)
  @ApiStandardErrors()
  async prescriptions(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.portal.prescriptions(user.id) };
  }
}
