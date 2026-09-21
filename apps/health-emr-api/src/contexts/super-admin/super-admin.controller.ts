import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedUser } from '@health-emr/types';
import { Role, VISIT_STAGES, listQuerySchema } from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiKeysetQuery, ApiStandardErrors, ApiZodBody, ApiZodOk } from '@/shared/http/api-docs';
import { columnFilterShape } from '@/shared/http/column-filters';
import { OverviewService } from './overview.service';
import {
  DirectoryService,
  PHARMACY_DIRECTORY_FILTERS,
  PROVIDER_DIRECTORY_FILTERS,
} from './directory.service';
import { AccountsService, ADMIN_FILTERS } from './accounts.service';
import {
  ClinicalService,
  PATIENT_FILTERS,
  PRESCRIPTION_FILTERS,
  VISIT_FILTERS,
} from './clinical.service';
import { RevenueService, type Grain } from './revenue.service';

// One schema serves both directories, so it accepts the column filters of each.
// The service applies only its own map, and the two share `status` on purpose.
const directoryQuerySchema = listQuerySchema
  .extend({
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    state: z.string().trim().length(2).toUpperCase().optional(),
    tenantId: z.string().uuid().optional(),
    providerId: z.string().uuid().optional(),
    ...columnFilterShape(PROVIDER_DIRECTORY_FILTERS),
    ...columnFilterShape(PHARMACY_DIRECTORY_FILTERS),
  })
  .strict();

const prescriptionQuerySchema = listQuerySchema
  .extend({
    status: z
      .enum(['SIGNED', 'TRANSMITTED', 'DISPENSED', 'SHIPPED', 'DELIVERED', 'VOIDED'])
      .optional(),
    tenantId: z.string().uuid().optional(),
    providerId: z.string().uuid().optional(),
    ...columnFilterShape(PRESCRIPTION_FILTERS),
  })
  .strict();

const visitQuerySchema = listQuerySchema
  .extend({
    stage: z.enum(VISIT_STAGES).optional(),
    tenantId: z.string().uuid().optional(),
    categorySlug: z.string().trim().max(80).optional(),
    // One parameter per filterable column, generated from the service's own
    // allowlist so the schema cannot fall behind what the service accepts.
    ...columnFilterShape(VISIT_FILTERS),
  })
  .strict();

const patientQuerySchema = listQuerySchema
  .extend({
    state: z.string().trim().length(2).toUpperCase().optional(),
    tenantId: z.string().uuid().optional(),
    ...columnFilterShape(PATIENT_FILTERS),
  })
  .strict();

const adminQuerySchema = listQuerySchema
  .extend({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
    ...columnFilterShape(ADMIN_FILTERS),
  })
  .strict();

const createAdminSchema = z
  .object({
    businessName: z.string().trim().min(2, 'Business name is required').max(200),
    ownerName: z.string().trim().min(2, 'Owner name is required').max(200),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
    phone: z.string().trim().max(40).optional(),
    categorySlugs: z.array(z.string().trim().max(120)).max(30).default([]),
  })
  .strict();

const statusChangeSchema = z
  .object({
    suspend: z.boolean(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.suspend && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Say why you are suspending this account',
      });
    }
  });

class DirectoryQueryDto extends createZodDto(directoryQuerySchema) {}
class PrescriptionQueryDto extends createZodDto(prescriptionQuerySchema) {}
class PatientQueryDto extends createZodDto(patientQuerySchema) {}
class VisitQueryDto extends createZodDto(visitQuerySchema) {}
class AdminQueryDto extends createZodDto(adminQuerySchema) {}
class CreateAdminDto extends createZodDto(createAdminSchema) {}
class StatusChangeDto extends createZodDto(statusChangeSchema) {}

const grainSchema = z.object({ grain: z.enum(['day', 'week', 'month']).default('month') }).strict();
class GrainDto extends createZodDto(grainSchema) {}

const bucket = z.object({
  period: z.string(),
  orders: z.number().int(),
  revenueCents: z.number().int(),
  costOfGoodsCents: z.number().int(),
  providerFeesCents: z.number().int(),
  profitCents: z.number().int(),
  pricedShare: z.number(),
});

/**
 * The platform owner's console.
 *
 * Every route is SUPER_ADMIN only and runs unscoped by tenant on purpose — this
 * is the one role that reads across every client business. An Admin reaching any
 * of these gets a 403 from the API, not a hidden button in the UI.
 */
@ApiTags('super-admin')
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'super-admin', version: '1' })
export class SuperAdminController {
  constructor(
    private readonly overview: OverviewService,
    private readonly directory: DirectoryService,
    private readonly accounts: AccountsService,
    private readonly clinical: ClinicalService,
    private readonly revenue: RevenueService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Platform summary',
    description:
      'Headline counts plus the active provider and pharmacy rosters. The counts come from one ' +
      'query rather than a dozen, because this page loads on every sign-in.',
  })
  @ApiStandardErrors()
  summary() {
    return this.overview.summary();
  }

  @Get('providers')
  @ApiOperation({
    summary: 'Provider directory',
    description:
      'Approved clinicians with their decision counts, approval rate, average time to decision and ' +
      'earnings. Aggregates are computed in SQL, once per page — not per row.',
  })
  @ApiKeysetQuery()
  @ApiStandardErrors()
  providers(@Query() query: DirectoryQueryDto) {
    return this.directory.listProviders(query);
  }

  @Get('providers/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One provider in full',
    description:
      'Identity, licences, qualifications, performance, earnings, the documents from their ' +
      'application and their recent decisions. Document URLs are authenticated streams, not public links.',
  })
  @ApiStandardErrors()
  async provider(@Param('id', ParseUUIDPipe) id: string) {
    const provider = await this.directory.getProvider(id);
    if (!provider) throw new NotFoundException('Provider not found');
    return provider;
  }

  @Get('pharmacies/directory')
  @ApiOperation({
    summary: 'Pharmacy directory',
    description: 'Approved pharmacies with catalogue size, monthly order volume and fulfilment time.',
  })
  @ApiKeysetQuery()
  @ApiStandardErrors()
  pharmacies(@Query() query: DirectoryQueryDto) {
    return this.directory.listPharmacies(query);
  }

  @Get('pharmacies/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One pharmacy in full',
    description:
      'Profile, integration settings, documents, recent orders, and the whole catalogue — every ' +
      'category with its products, concentrations, vial sizes and cost of goods.',
  })
  @ApiStandardErrors()
  async pharmacy(@Param('id', ParseUUIDPipe) id: string) {
    const pharmacy = await this.directory.getPharmacy(id);
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    return pharmacy;
  }

  @Get('revenue/summary')
  @ApiOperation({
    summary: 'Revenue, cost and profit across the platform',
    description:
      'Today, this month, the last three months and all time. Revenue is what we charge client ' +
      'businesses; cost is what pharmacies charge us plus what clinicians are paid for reviews. ' +
      'Counted from orders, which only exist once a clinician approved the line — a refused ' +
      'request earns nothing and is excluded by construction.',
  })
  @ApiStandardErrors()
  revenueSummary() {
    return this.revenue.summary();
  }

  @Get('revenue/series')
  @ApiOperation({
    summary: 'Revenue over time',
    description:
      '`grain=day` is the last 30 days, `week` the last 3 months, `month` the last 12. Empty ' +
      'periods come back as zeroes rather than being omitted, so a quiet week is drawn as a dip ' +
      'rather than smoothed over by the line either side of it.',
  })
  @ApiZodOk(z.array(bucket))
  @ApiStandardErrors()
  revenueSeries(@Query() query: GrainDto) {
    return this.revenue.series(query.grain as Grain);
  }

  @Get('revenue/by-tenant')
  @ApiOperation({
    summary: 'Revenue and profit per client business',
    description: 'Which accounts earn their keep. Clients that ordered nothing are included.',
  })
  @ApiStandardErrors()
  revenueByTenant(@Query() query: GrainDto) {
    return this.revenue.byTenant(query.grain as Grain);
  }

  @Get('revenue/unpriced')
  @ApiOperation({
    summary: 'Products priced in a way that loses money',
    description:
      'Unpriced, priced below cost, or priced with no cost recorded behind it. All three are ' +
      'silent in a total — an unpriced product just makes the margin look worse, and a below-cost ' +
      'one makes volume look like success. Reported rather than blocked: selling under cost is ' +
      'sometimes deliberate, and a rule that refuses it would only be worked around.',
  })
  @ApiStandardErrors()
  pricingProblems() {
    return this.revenue.pricingProblems();
  }

  @Get('patients')
  @ApiOperation({
    summary: 'Every patient, across every account',
    description:
      'The platform sees one record per person even when several client businesses have sent them. ' +
      'Each tenant only ever sees its own link to that person.',
  })
  @ApiKeysetQuery()
  @ApiStandardErrors()
  patients(@Query() query: PatientQueryDto) {
    return this.clinical.listPatients(query);
  }

  @Get('patients/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One complete patient record',
    description:
      'Demographics, allergies, conditions, medications, vitals, labs, visits, prescriptions and ' +
      'shipments. Nothing is withheld from this role — and every read is recorded as break-the-glass.',
  })
  @ApiStandardErrors()
  patient(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clinical.getPatient(id, user.id);
  }

  @Get('prescriptions')
  @ApiOperation({
    summary: 'Every prescription',
    description: 'Across all accounts, with the prescriber, the licence it was signed under, and its shipment.',
  })
  @ApiKeysetQuery()
  @ApiStandardErrors()
  prescriptions(@Query() query: PrescriptionQueryDto) {
    return this.clinical.listPrescriptions(query);
  }

  @Get('visits')
  @ApiOperation({
    summary: 'Every visit, across every client',
    description:
      'The whole platform in one list: who the patient is, which client sent them, what was asked ' +
      'for and how far it got. Carries the same derived `stage` and the same filter predicate the ' +
      'client sees on its own list, so the two can never disagree.\n\n' +
      'Withdrawn visits appear here, marked, and nowhere else.',
  })
  @ApiKeysetQuery()
  @ApiStandardErrors()
  visits(@Query() query: VisitQueryDto) {
    return this.clinical.listVisits(query);
  }

  @Get('visits/:id/questionnaire')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit (prescription request) id' })
  @ApiOperation({
    summary: 'The questionnaire behind a visit',
    description:
      'Decrypted intake answers, the clinical free text, and what the provider decided on each ' +
      'requested line. The most sensitive content the system holds, so the read is break-the-glass.',
  })
  @ApiStandardErrors()
  questionnaire(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clinical.getVisitQuestionnaire(id, user.id);
  }

  @Get('admins')
  @ApiOperation({
    summary: 'Admin accounts',
    description: 'The telehealth businesses using the platform, with their patient and order counts.',
  })
  @ApiKeysetQuery()
  @ApiStandardErrors()
  admins(@Query() query: AdminQueryDto) {
    return this.accounts.listAdmins(query);
  }

  @Post('admins')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an admin account',
    description:
      'Creates the tenant and its owner, then emails an invite. No password is ever set here — the ' +
      'owner sets their own, so nobody else knows a credential that works.',
  })
  @ApiZodBody(CreateAdminDto)
  @ApiZodOk(z.object({ tenantId: z.string().uuid(), slug: z.string(), ownerUserId: z.string().uuid() }))
  @ApiStandardErrors()
  createAdmin(@Body() body: CreateAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.createAdmin(body, user.id);
  }

  @Post('admins/:id/resend-invite')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Resend the owner invite',
    description: 'Revokes any outstanding invite first, so an older link stops working.',
  })
  @ApiStandardErrors()
  resendInvite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.resendInvite(id, user.id);
  }

  @Post(':kind/:id/status')
  @HttpCode(200)
  @ApiParam({ name: 'kind', enum: ['provider', 'pharmacy', 'tenant'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Suspend or reactivate',
    description:
      'Suspending a provider also stops them being routed new work — otherwise the queue would keep ' +
      'assigning visits to someone who cannot act on them.',
  })
  @ApiZodBody(StatusChangeDto)
  @ApiStandardErrors()
  setStatus(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StatusChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const allowed = ['provider', 'pharmacy', 'tenant'] as const;
    const resolved = allowed.find((value) => value === kind) ?? 'provider';
    return this.accounts.setStatus(resolved, id, body.suspend, body.reason, user.id);
  }
}
