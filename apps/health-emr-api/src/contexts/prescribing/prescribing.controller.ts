import {
  Body,
  Put,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedUser } from '@health-emr/types';
import {
  Role,
  decideRequestSchema,
  signatureSchema,
  providerLicenceInputSchema,
  providerQueueQuerySchema,
} from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import {
  ApiKeysetOk,
  ApiKeysetQuery,
  ApiStandardErrors,
  ApiZodBody,
  ApiZodOk,
} from '@/shared/http/api-docs';
import { PrescribingService } from './prescribing.service';
import { EarningsService } from './earnings.service';
import { ProviderLicencesService } from '@/contexts/practitioners/provider-licences.service';
import { ProviderActivityService } from '@/contexts/practitioners/provider-activity.service';
import { SignatureService } from '@/contexts/practitioners/signature.service';
import { activityQuerySchema } from '@/contexts/practitioners/activity-query';

class DecideDto extends createZodDto(decideRequestSchema) {}

/**
 * Long enough for a real clinical question, short enough that it stays one.
 *
 * The minimum is not bureaucratic: "?" posted to a patient who is waiting on a
 * decision tells them nothing and costs them a day.
 */
const requestInformationSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(10, 'Ask a question the patient can actually answer')
      .max(2000),
  })
  .strict();
class RequestInformationDto extends createZodDto(requestInformationSchema) {}
class QueueQueryDto extends createZodDto(providerQueueQuerySchema) {}
class ProviderLicenceDto extends createZodDto(providerLicenceInputSchema) {}
class SignatureDto extends createZodDto(signatureSchema) {}
class ActivityQueryDto extends createZodDto(activityQuerySchema) {}

const queueRow = z.object({
  visitId: z.string().uuid(),
  masterId: z.string(),
  status: z.string(),
  waitingSince: z.string(),
  decidedAt: z.string().nullable().describe('Null while the visit is still open.'),
  referredAt: z.string().nullable(),
  reason: z.string().nullable().describe('Why it was refused, where it was.'),
  tenant: z.string(),
  category: z.string(),
  patient: z.object({
    id: z.string().uuid(),
    mrn: z.string(),
    name: z.string(),
    state: z.string(),
  }),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      nameText: z.string(),
      strength: z.string(),
      quantity: z.string(),
      decision: z.string(),
      decisionReason: z.string().nullable(),
    }),
  ),
});

const decisionResult = z.object({
  visitId: z.string().uuid(),
  status: z.enum(['APPROVED', 'DENIED']),
  prescriptionIds: z.array(z.string().uuid()),
});

const earningsSummary = z.object({
  work: z.object({
    decided: z.number().int(),
    approved: z.number().int(),
    denied: z.number().int(),
    thisMonth: z.number().int(),
    approvalRate: z.number().int().nullable(),
  }),
  balance: z.object({
    unpaidCents: z.number().int(),
    awaitingApprovalCents: z.number().int(),
    approvedForPayoutCents: z.number().int(),
    paidCents: z.number().int(),
    lifetimeCents: z.number().int(),
    since: z.string().nullable(),
  }),
  unrecorded: z.number().int(),
});

const earningRow = z.object({
  id: z.string().uuid(),
  visitId: z.string().uuid(),
  masterId: z.string(),
  category: z.string(),
  patientMrn: z.string(),
  client: z.string(),
  outcome: z.string(),
  amountCents: z.number().int(),
  status: z.string(),
  earnedAt: z.string(),
  paidAt: z.string().nullable(),
  payoutReference: z.string().nullable(),
});

/**
 * The provider's workspace.
 *
 * Restricted to PROVIDER, and every route resolves the caller to their own
 * provider profile — a provider cannot reach another provider's queue or decide
 * a visit that was not assigned to them, even by guessing an id.
 */
@ApiTags('clinic')
@Roles(Role.PROVIDER)
@Controller({ path: 'clinic', version: '1' })
export class PrescribingController {
  constructor(
    private readonly prescribing: PrescribingService,
    private readonly earnings: EarningsService,
    private readonly licences: ProviderLicencesService,
    private readonly activity: ProviderActivityService,
    private readonly signature: SignatureService,
  ) {}

  @Get('me/summary')
  @ApiOperation({
    summary: 'My workload and balance',
    description:
      'Reviews completed, split by outcome, and what has been recorded as earned against them — ' +
      'unpaid, paid and lifetime. Reviews and earnings are counted from separate tables, so a ' +
      'decision whose earning failed to record appears as `unrecorded` rather than as money ' +
      'silently missing from the total.',
  })
  @ApiZodOk(earningsSummary)
  @ApiStandardErrors()
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.earnings.summaryFor(providerId);
  }

  @Get('me/earnings')
  @ApiOperation({
    summary: 'The ledger behind my balance',
    description:
      'One line per completed review: what it was, which client sent it, what it paid, and ' +
      'whether it has been paid out yet.',
  })
  @ApiZodOk(z.object({ data: z.array(earningRow) }))
  @ApiStandardErrors()
  async earningsLedger(@CurrentUser() user: AuthenticatedUser) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return { data: await this.earnings.ledgerFor(providerId) };
  }

  @Get('me/signature')
  @ApiOperation({
    summary: 'My signature',
    description:
      'What is on file, and when it was drawn. Held encrypted and returned only to the clinician ' +
      'it belongs to.',
  })
  @ApiStandardErrors()
  async mySignature(@CurrentUser() user: AuthenticatedUser) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.signature.forProvider(providerId);
  }

  @Put('me/signature')
  @ApiOperation({
    summary: 'Draw or replace my signature',
    description:
      'Drawn once and applied at each signing, rather than redrawn sixty times in an afternoon — ' +
      'what makes each signing deliberate is the confirmation at the point of signing. Replacing ' +
      'it changes nothing already signed: every prescription keeps its own copy from the moment ' +
      'it was signed.',
  })
  @ApiZodBody(SignatureDto)
  @ApiStandardErrors()
  async captureSignature(@CurrentUser() user: AuthenticatedUser, @Body() body: SignatureDto) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.signature.capture(providerId, body, user.id);
  }

  @Get('me/activity')
  @ApiOperation({
    summary: 'My hours, day by day',
    description:
      'How long I was actually working each day, worked out from the actions I took rather than ' +
      'from how long a tab was open. A gap longer than the idle window ends a session.',
  })
  @ApiStandardErrors()
  async myActivity(@CurrentUser() user: AuthenticatedUser, @Query() query: ActivityQueryDto) {
    return this.activity.forUser(user.id, query.days, query.timeZone);
  }

  @Get('me/licences')
  @ApiOperation({
    summary: 'The states I am licensed in',
    description:
      'What the platform holds for me, including any I have added that are still waiting to be ' +
      'checked. Only ACTIVE licences are used to route visits.',
  })
  @ApiStandardErrors()
  async myLicences(@CurrentUser() user: AuthenticatedUser) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.licences.list(providerId);
  }

  @Post('me/licences')
  @ApiOperation({
    summary: 'Add a state I am licensed in',
    description:
      'Recorded as PENDING and checked by the platform before it counts. Visits are routed only ' +
      'on an ACTIVE licence, so adding one here does not by itself let me review patients in ' +
      'that state — which is deliberate, since nobody has verified it yet.',
  })
  @ApiZodBody(ProviderLicenceDto)
  @ApiStandardErrors()
  async addMyLicence(@CurrentUser() user: AuthenticatedUser, @Body() body: ProviderLicenceDto) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.licences.add(providerId, body, user.id, false);
  }

  @Get('queue')
  @ApiOperation({
    summary: 'Visits assigned to me',
    description:
      'Keyset-paginated, oldest first by default so the longest-waiting patient surfaces first. ' +
      'Filter by status, category, patient state, or free text across master ID, surname and MRN.',
  })
  @ApiKeysetQuery()
  @ApiKeysetOk(queueRow)
  @ApiStandardErrors()
  async queue(@CurrentUser() user: AuthenticatedUser, @Query() query: QueueQueryDto) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.prescribing.queue(providerId, query);
  }

  @Get('visits/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One visit, in full',
    description:
      'The questionnaire the patient answered, their allergies, conditions and medications, any ' +
      'photographs they uploaded, and what they asked for. This is what a decision is made from — ' +
      'approving without reading it is paperwork, not medicine.',
  })
  @ApiStandardErrors()
  async visit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.prescribing.visit(providerId, id);
  }

  @Get('visits/:id/photos/:documentId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'View a photo from a visit',
    description:
      'Streams the image itself. Identity documents are the reason a clinician can prescribe at all, ' +
      'so the read is recorded against the patient like any other look at their chart.',
  })
  @Header('Cache-Control', 'private, no-store')
  @ApiStandardErrors()
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    const file = await this.prescribing.visitPhoto(providerId, id, documentId, user.id);
    response.setHeader('Content-Type', file.mime);
    return new StreamableFile(file.body);
  }

  @Post('visits/:id/start')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiOperation({
    summary: 'Open a visit for review',
    description: 'Moves the visit to IN_REVIEW and stamps when review began. Idempotent.',
  })
  @ApiZodOk(z.object({ status: z.string() }))
  @ApiStandardErrors()
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.prescribing.startReview(id, providerId);
  }

  @Post('visits/:id/request-information')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiOperation({
    summary: 'Ask the patient something before deciding',
    description:
      'Puts the visit on hold and posts the question into the conversation this patient already ' +
      'has with this clinician — where the patient can answer in words or attach a photograph, ' +
      'and where the answer becomes part of the chart.\n\n' +
      'The patient is nudged through whatever they have consented to, and that nudge carries no ' +
      'clinical detail: a text arrives on a lock screen anyone nearby can read. The visit returns ' +
      'to the queue as soon as they reply.',
  })
  @ApiZodBody(RequestInformationDto)
  @ApiStandardErrors()
  async requestInformation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RequestInformationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.prescribing.requestInformation({
      requestId: id,
      providerId,
      actingUserId: user.id,
      question: body.question,
    });
  }

  @Post('visits/:id/decide')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiOperation({
    summary: 'Decide every line and sign',
    description:
      'Every line item must be decided in one call — a half-reviewed visit is not a decision. ' +
      'APPROVED and MODIFIED both require directions for use; MODIFIED and DENIED both require a ' +
      'reason. Each approved line becomes a signed prescription carrying the prescriber name and ' +
      'licence as they were at the moment of signature. Licensure is re-checked here, not just at ' +
      'assignment, because a licence can lapse in between.',
  })
  @ApiZodBody(DecideDto)
  @ApiZodOk(decisionResult, 'Decision recorded and prescriptions signed')
  @ApiStandardErrors()
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const providerId = await this.prescribing.providerIdForUser(user.id);
    return this.prescribing.decide({
      requestId: id,
      providerId,
      actingUserId: user.id,
      input: body,
    });
  }
}
