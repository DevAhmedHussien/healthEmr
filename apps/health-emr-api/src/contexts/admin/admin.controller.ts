import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  Role,
  VISIT_STAGES,
  listQuerySchema,
  type AuthenticatedUser,
} from '@health-emr/types';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentTenant } from '@/shared/auth/decorators/current-tenant.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { createZodDto } from '@/shared/http/zod-dto';
import { ApiStandardErrors, ApiZodOk } from '@/shared/http/api-docs';
import { AdminService } from './admin.service';
import { AdminClinicalService } from './admin-clinical.service';
import { RevenueService, type Grain } from '../super-admin/revenue.service';
import { ApiAccessService } from '@/contexts/tenancy/api-access.service';
import { columnFilterShape } from '@/shared/http/column-filters';
import {
  ADMIN_PATIENT_FILTERS,
  ADMIN_PRESCRIPTION_FILTERS,
  ADMIN_VISIT_FILTERS,
} from './admin-clinical.service';

const patientQuerySchema = listQuerySchema
  .extend({ state: z.string().length(2).optional(), ...columnFilterShape(ADMIN_PATIENT_FILTERS) })
  .strict();

const visitQuerySchema = listQuerySchema
  .extend({
    stage: z.enum(VISIT_STAGES).optional(),
    categorySlug: z.string().trim().max(80).optional(),
    ...columnFilterShape(ADMIN_VISIT_FILTERS),
  })
  .strict();

const prescriptionQuerySchema = listQuerySchema
  .extend({
    status: z
      .enum(['SIGNED', 'TRANSMITTED', 'DISPENSED', 'SHIPPED', 'DELIVERED', 'VOIDED'])
      .optional(),
    ...columnFilterShape(ADMIN_PRESCRIPTION_FILTERS),
  })
  .strict();

const grainSchema = z.object({ grain: z.enum(['day', 'week', 'month']).default('month') }).strict();
class GrainDto extends createZodDto(grainSchema) {}

/**
 * One period of spend, as the client is allowed to see it.
 *
 * The revenue service returns the platform's whole picture — what we charge,
 * what the pharmacy charges us, what the clinician was paid, and the margin
 * between them. A client business is entitled to exactly one of those numbers:
 * what it owes. Our cost base and our margin are not theirs to read, and this is
 * the function that decides that rather than each caller remembering to.
 */
function toSpend(bucket: {
  orders: number;
  revenueCents: number;
  patientPaidCents: number;
  patientPricedShare: number;
  pricedShare: number;
}) {
  const earnedCents = bucket.patientPaidCents;
  const spendCents = bucket.revenueCents;

  return {
    medications: bucket.orders,
    /** What this business took from its patients, as reported at intake. */
    earnedCents,
    /** What it owes us for those medications. */
    spendCents,
    /** What is left. Its business, not ours — we only hold both halves. */
    marginCents: earnedCents - spendCents,
    // Null rather than 0% when nothing was earned: a margin on no revenue is
    // undefined, and a zero reads as "we made nothing" rather than "unknown".
    marginPercent: earnedCents > 0 ? Math.round(((earnedCents - spendCents) / earnedCents) * 100) : null,
    // A total built from orders where some had no agreed price is not exact, and
    // an invoice that arrives higher than the dashboard said is worse than a
    // dashboard that admitted it was incomplete.
    pricedShare: bucket.pricedShare,
    /**
     * Share of lines that carried a patient price at intake.
     *
     * Below 1 means this business did not tell us what it charged for some
     * medications, so its own revenue — and therefore its margin — is
     * understated here. Its problem to fix, but only if it is told.
     */
    patientPricedShare: bucket.patientPricedShare,
  };
}

class PatientQueryDto extends createZodDto(patientQuerySchema) {}
class VisitQueryDto extends createZodDto(visitQuerySchema) {}
class PrescriptionQueryDto extends createZodDto(prescriptionQuerySchema) {}

/**
 * The telehealth business's own view.
 *
 * Every route here is confined twice over. The Prisma tenant extension keeps
 * each query inside the caller's tenant, so another client's records are not
 * hidden but absent. On top of that the redaction policy decides which parts of
 * a chart this role may read — declared in one place, so widening it is a
 * reviewable change rather than an accident in a `select`.
 */
@ApiTags('admin')
@Roles(Role.ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly clinical: AdminClinicalService,
    private readonly revenue: RevenueService,
    private readonly apiAccess: ApiAccessService,
  ) {}

  /** The platform's revenue from this client, which is this client's bill. */
  private async spendFor(tenantId: string) {
    const summary = await this.revenue.summary(tenantId);

    return {
      today: toSpend(summary.today),
      thisMonth: toSpend(summary.thisMonth),
      lastThreeMonths: toSpend(summary.lastThreeMonths),
      last12Months: toSpend(summary.last12Months),
    };
  }

  @Get('overview')
  @ApiOperation({
    summary: 'How many visits sit at each stage',
    description:
      'Counted with the same predicates the visit list filters by, so a tile and the table it ' +
      'links to can never disagree.',
  })
  @ApiStandardErrors()
  overview(@CurrentTenant() tenantId: string | null) {
    return this.clinical.overview(this.admin.tenantIdOrThrow(tenantId));
  }

  @Get('spend/summary')
  @ApiOperation({
    summary: 'What I owe the platform',
    description:
      'Today, this month, the last three months and the last twelve. Charged per approved ' +
      'medication at the price agreed for it. A visit a clinician did not approve is never ' +
      'charged for — no order is created, so there is nothing to bill.',
  })
  @ApiStandardErrors()
  spendSummary(@CurrentTenant() tenantId: string | null) {
    return this.spendFor(this.admin.tenantIdOrThrow(tenantId));
  }

  @Get('spend/series')
  @ApiOperation({
    summary: 'What I owe over time',
    description:
      '`grain=day` is the last 30 days, `week` the last 3 months, `month` the last 12. Empty ' +
      'periods come back as zeroes rather than being omitted.',
  })
  @ApiStandardErrors()
  async spendSeries(@CurrentTenant() tenantId: string | null, @Query() query: GrainDto) {
    const series = await this.revenue.series(query.grain as Grain, this.admin.tenantIdOrThrow(tenantId));
    return series.map((bucket) => ({ period: bucket.period, ...toSpend(bucket) }));
  }

  @Get('patients')
  @ApiOperation({
    summary: 'My patients',
    description:
      'Only people my business has sent. Visit and prescription counts are counted through my ' +
      'tenant too — a patient who also buys elsewhere does not reveal that here.',
  })
  @ApiStandardErrors()
  patients(@CurrentTenant() tenantId: string | null, @Query() query: PatientQueryDto) {
    return this.clinical.listPatients(this.admin.tenantIdOrThrow(tenantId), query);
  }

  @Get('patients/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One patient',
    description:
      'Demographics, contact and ID-verification status. Sections this role may not read are ' +
      'listed in `redactedSections` so the UI can say they were withheld rather than imply the ' +
      'patient has none.',
  })
  @ApiZodOk(
    z.object({
      patientId: z.string().uuid(),
      mrn: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      dateOfBirth: z.string(),
      redactedSections: z.array(z.string()),
    }),
  )
  @ApiStandardErrors()
  patient(@CurrentTenant() tenantId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPatient(this.admin.tenantIdOrThrow(tenantId), id);
  }

  @Get('visits')
  @ApiOperation({
    summary: 'My visits',
    description:
      'Every visit my business submitted, each carrying one derived `stage` — pending review, ' +
      'more information needed, refused, approved, sent to pharmacy, being filled, shipped, ' +
      'delivered, stuck or cancelled. The stage is computed from the request, the prescription ' +
      'and the pharmacy order together, and the `stage` filter reconstructs the same definition ' +
      'in SQL so the result count is the real one.',
  })
  @ApiStandardErrors()
  visits(@CurrentTenant() tenantId: string | null, @Query() query: VisitQueryDto) {
    return this.clinical.listVisits(this.admin.tenantIdOrThrow(tenantId), query);
  }

  @Get('visits/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One visit in full',
    description:
      'The intake the patient submitted, the photos they uploaded, what was requested, what was ' +
      'prescribed, and where the pharmacy order got to. Provider notes and lab results are ' +
      'withheld and named in `redactedSections`. The read is recorded against the patient.',
  })
  @ApiStandardErrors()
  visit(
    @CurrentTenant() tenantId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clinical.getVisit(this.admin.tenantIdOrThrow(tenantId), id, user.id);
  }

  @Get('visits/:id/photos/:documentId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'View a photo from one of my visits',
    description:
      'Streams the image. Reached through the visit, so a document id on its own opens nothing, ' +
      'and recorded against the patient like any other look at their chart.',
  })
  @Header('Cache-Control', 'private, no-store')
  @ApiStandardErrors()
  async photo(
    @CurrentTenant() tenantId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.clinical.visitPhoto(
      this.admin.tenantIdOrThrow(tenantId),
      id,
      documentId,
      user.id,
    );
    response.setHeader('Content-Type', file.mime);
    return new StreamableFile(file.body);
  }

  @Get('prescriptions')
  @ApiOperation({
    summary: 'My prescriptions',
    description:
      'What was actually signed, under which licence, and where the pharmacy order got to. Each ' +
      'row carries the same derived `stage` as the visit it came from, so the two never appear to ' +
      'disagree about where an order is.',
  })
  @ApiStandardErrors()
  prescriptions(@CurrentTenant() tenantId: string | null, @Query() query: PrescriptionQueryDto) {
    return this.clinical.listPrescriptions(this.admin.tenantIdOrThrow(tenantId), query);
  }

  // ── integration credentials ──────────────────────────────────────────────
  //
  // Read only. A client can see which keys exist on its account, which are
  // live, and when each was last used — enough to hand the right one to an
  // integrator and to notice one nobody is using. Minting and deleting them
  // stays with the platform owner: a credential is the only thing that makes a
  // submission attributable, and the account whose submissions it vouches for
  // is the wrong account to be issuing it to itself.

  @Get('api-access')
  @ApiOperation({
    summary: 'How I authenticate to the API',
    description:
      'My company key, the base URL to post visits to, and the keys issued to my account. The ' +
      'keys themselves are not stored and cannot be shown again — ask the platform owner for a ' +
      'new one if you have lost it, or to remove one you no longer use.',
  })
  @ApiStandardErrors()
  integration(@CurrentTenant() tenantId: string | null) {
    return this.apiAccess.overview(this.admin.tenantIdOrThrow(tenantId));
  }
}
