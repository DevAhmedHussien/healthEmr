import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import {
  EXTERNAL_STATUSES,
  cancelVisitSchema,
  partnerIntakeSchema,
  partnerVisitUpdateSchema,
  updateVisitSchema,
  visitPhotosSchema,
  type PartnerIntake,
} from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { ApiZodBody, ApiZodOk } from '@/shared/http/api-docs';
import { Public } from '@/shared/auth/decorators/public.decorator';
import { PartnerRoute } from '@/shared/auth/decorators/partner.decorator';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { IntakeService } from './intake.service';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { PartnerError } from './partner-errors';
import { VisitPhotosService } from './visit-photos.service';
import { QuestionnaireService } from './questionnaire.service';
import { ExternalVisitService } from './external-visit.service';
import { ExternalFetchService } from './external-fetch.service';

class PartnerIntakeDto extends createZodDto(partnerIntakeSchema) {}
class VisitPhotosDto extends createZodDto(visitPhotosSchema) {}
class PartnerVisitUpdateDto extends createZodDto(partnerVisitUpdateSchema) {}
class UpdateVisitDto extends createZodDto(updateVisitSchema) {}
class CancelVisitDto extends createZodDto(cancelVisitSchema) {}

interface PartnerRequest extends Request {
  tenantId: string;
  tenantSlug: string;
}

/**
 * The tenant-facing API.
 *
 * Shaped to match the incumbent's contract so a client already integrated with
 * Beluga can repoint by changing a base URL and a token — which is also how we
 * run the migration in shadow mode.
 *
 * Authenticated by tenant API key (PartnerAuthGuard), never by a user session.
 */
// Documented, not excluded. This is the contract a client business integrates
// against — hiding it from Swagger meant the one endpoint an integrator needs
// was the one they could not look up.
@ApiTags('partner')
@ApiSecurity('tenant-api-key')
@Public()
@PartnerRoute()
@Controller({ path: 'partner/v1', version: VERSION_NEUTRAL })
export class PartnerController {
  constructor(
    private readonly intake: IntakeService,
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly photos: VisitPhotosService,
    private readonly questionnaires: QuestionnaireService,
    private readonly external: ExternalVisitService,
    private readonly lookups: ExternalFetchService,
  ) {}

  /**
   * The key in the body has to name the account the header authenticated.
   *
   * The incumbent took the key in the payload and clients migrating send both.
   * Ignoring one would mean a request whose two halves disagree is processed as
   * whichever half we happened to read — so they are compared, and a mismatch
   * is refused in the contract's own vocabulary rather than with a 401 the
   * client has no handler for.
   */
  private keyMatches(presented: string, req: PartnerRequest): boolean {
    const header = (req.headers.authorization ?? '').replace(/^Bearer /i, '').trim();
    return presented.trim() === header;
  }

  @Post('visit/createNoPayPhotos')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit a visit',
    description:
      'The one endpoint a client business calls. A patient finishes your intake form and you post ' +
      'it here; everything after this happens on our side and is reported back to the patient.\n\n' +
      '**What the payload names.** `company` is your account slug, `visitType` the treatment area ' +
      '(this is the category), `pharmacyId` the pharmacy slug you are contracted to, and ' +
      '`masterId` your own order id — which is also the idempotency key, so a retry is safe and a ' +
      'reused one is refused.\n\n' +
      '**`formObj.patientPreference[]`** is what the patient chose: `medId` is the platform ' +
      'medication id (from `GET /partner/v1/pharmacies/{pharmacyId}/medications` — not the ' +
      "pharmacy's kit code), plus strength, quantity, refills and days supply. Send " +
      '`patientPaidCents` per line to see your own margin in the console.\n\n' +
      '**`Q1`/`A1` … `Qn`/`An`** carry the questionnaire. They are encrypted at rest and only a ' +
      'clinician and you can read them back.\n\n' +
      '**What happens next.** The visit is checked against your entitlements, the state the ' +
      'patient was in, and whether that pharmacy stocks what was chosen — all refusals arrive now, ' +
      'as a 400 you can act on, rather than as a patient waiting. It then routes to a licensed ' +
      'clinician, who approves or refuses. An approval is signed, sent to the pharmacy and ' +
      'shipped. The patient is told at each of those four steps in their own messages.\n\n' +
      'Photographs are posted separately to `POST /partner/v1/visit/{visitId}/photos`.',
  })
  @ApiZodBody(PartnerIntakeDto)
  @ApiZodOk(
    z.object({
      status: z.literal(200),
      info: z.string(),
      data: z.object({
        masterId: z.string().describe('Echoed back — your own order id.'),
        visitId: z.string().uuid().describe('Ours. Use it to attach photos.'),
      }),
    }),
    'The visit was created and is on its way to a clinician',
  )
  @ApiResponse({
    status: 400,
    description:
      'Refused, with a reason in `error`: an unknown medId, a visit type or pharmacy your account ' +
      'is not entitled to, a pharmacy that does not stock what was chosen, a state you may not ' +
      'serve, or a masterId already used.',
    schema: {
      type: 'object',
      properties: { status: { type: 'integer' }, error: { type: 'string' } },
    },
  })
  async createVisit(@Body() body: PartnerIntakeDto, @Req() req: PartnerRequest) {
    const result = await this.intake.submit(
      req.tenantId,
      req.tenantSlug,
      body as unknown as PartnerIntake,
    );

    return {
      status: 200,
      info: 'Patient visit created successfully',
      data: { masterId: result.masterId, visitId: result.visitId },
    };
  }

  /** Lookup: the pharmacies this tenant may name in `pharmacyId`. */
  @Get('pharmacies')
  async pharmacies(@Req() req: PartnerRequest) {
    const rows = await this.prisma.raw.tenantPharmacy.findMany({
      where: { tenantId: req.tenantId },
      include: {
        pharmacy: {
          select: { slug: true, name: true, dispensesBranded: true, dispensesCompounded: true },
        },
      },
    });

    return {
      status: 200,
      data: rows.map((row) => ({
        pharmacyId: row.pharmacy.slug,
        name: row.pharmacy.name,
        isDefault: row.isDefault,
        dispensesBranded: row.pharmacy.dispensesBranded,
        dispensesCompounded: row.pharmacy.dispensesCompounded,
      })),
    };
  }

  /**
   * Attach photos to a visit.
   *
   * Posted after the intake, against the `visitId` it returned — a government
   * ID, and sometimes a prescription label. Kept off the intake payload because
   * several megabytes of base64 inside the call that creates a patient makes a
   * retry expensive and a timeout likely.
   */
  @Post('visit/photos')
  @HttpCode(200)
  async visitPhotos(@Body() body: VisitPhotosDto, @Req() req: PartnerRequest) {
    const result = await this.photos.attach(req.tenantId, body.visitId, body.images, body.kind);
    return { status: 200, data: result };
  }

  /**
   * The questions this visit type asks.
   *
   * A client building its own intake form renders these; one posting the payload
   * by hand can ignore them and send `Q1`/`A1` pairs of its own. Either way the
   * clinician sees the same thing.
   */
  @Get('questionnaire/:visitType')
  async questionnaire(@Param('visitType') visitType: string, @Req() req: PartnerRequest) {
    const result = await this.questionnaires.forVisitType(req.tenantId, visitType);
    if (!result) return { status: 400, error: PartnerError.VISIT_TYPE_NOT_ENABLED };
    return { status: 200, data: result };
  }

  @Patch('visit/:masterId')
  @HttpCode(200)
  @ApiParam({ name: 'masterId', description: 'Your own order id, as sent on the visit.' })
  @ApiOperation({
    summary: 'Correct a visit',
    description:
      'Fixes the contact and delivery details on a visit you already sent — a mistyped phone ' +
      'number, a wrong street. Send only the fields that change.\n\n' +
      '**Only until a clinician decides.** After that the address on the chart is the one they ' +
      'decided against and the order is with a pharmacy, so this returns 400. Correct it with the ' +
      'pharmacy, or ask us to withdraw the visit and send a new one.\n\n' +
      '**The questionnaire cannot be changed at all.** It is what the patient attested to, and ' +
      'answers that can be edited afterwards are not evidence of anything. Nor can the state: it ' +
      'decides which clinician may treat them, and that is already settled.',
  })
  @ApiZodBody(PartnerVisitUpdateDto)
  @ApiZodOk(
    z.object({
      status: z.literal(200),
      data: z.object({
        masterId: z.string(),
        visitId: z.string().uuid(),
        changed: z.array(z.string()).describe('The fields that actually changed.'),
      }),
    }),
    'The visit was corrected',
  )
  @ApiResponse({
    status: 400,
    description:
      'No visit with that masterId on your account, or a clinician has already decided it.',
  })
  async updateVisit(
    @Param('masterId') masterId: string,
    @Body() body: PartnerVisitUpdateDto,
    @Req() req: PartnerRequest,
  ) {
    return {
      status: 200,
      data: await this.intake.update(req.tenantId, masterId, body),
    };
  }

  // ── the external surface ─────────────────────────────────────────────────

  @Post('external/updateVisit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update a visit, or re-send its prescription',
    description:
      'One call for two situations, because from your side it is one question — here is the ' +
      'corrected order — and which one it becomes depends on something you cannot see: whether a ' +
      'clinician has reached the visit yet.\n\n' +
      '**Before a decision** the requested medications and pharmacy are replaced and you get ' +
      '`VISIT_DATA_UPDATED`. The lines you send replace the ones on the visit rather than merging ' +
      'with them, so send the whole order, not a patch.\n\n' +
      '**After an approval** the clinician\u2019s decision is re-issued against the corrected ' +
      'order and you get `NEW_RX_SENT`. No clinician is asked again, which is only safe because ' +
      'of the four guards below — the resend has to be materially the prescription that was ' +
      'approved:\n\n' +
      '- same dosage category as the original — otherwise `CATEGORY_MISMATCH`\n' +
      '- a pharmacy that stocks it — otherwise `PHARMACY_MISMATCH`\n' +
      '- within 7 days of signing — otherwise `TOO_LONG_AGO`\n' +
      '- within your account\u2019s retry limit — otherwise `TOO_MANY_RETRIES`\n\n' +
      '**After a refusal** there is no prescription to re-send, so a correction is treated as an ' +
      'amendment and returns `VISIT_DATA_UPDATED`. **After a referral** nothing is accepted: the ' +
      'clinician sent the patient elsewhere, and that answer was not about the medication.\n\n' +
      '**No field may be null, undefined or empty.** Each is refused by name before anything is ' +
      'processed. `apiKey` must match the bearer token on the request.\n\n' +
      'Every outcome is HTTP 200 with a `status` in the body.',
  })
  @ApiZodBody(UpdateVisitDto)
  @ApiZodOk(
    z.object({
      status: z.enum(EXTERNAL_STATUSES),
      info: z.string(),
      medsPrescribed: z
        .array(
          z.object({
            rxName: z.string(),
            rxStrength: z.string(),
            rxRefills: z.string(),
            rxQuantity: z.string(),
            rxId: z.string(),
            rxDirections: z.string(),
            medId: z.string(),
          }),
        )
        .optional()
        .describe('Present only on NEW_RX_SENT.'),
    }),
    'Processed. Read `status` for the outcome.',
  )
  @ApiResponse({ status: 400, description: 'A field was missing, empty, or the wrong type.' })
  async externalUpdateVisit(@Body() body: UpdateVisitDto, @Req() req: PartnerRequest) {
    if (!this.keyMatches(body.apiKey, req)) {
      return { status: 'GENERIC', info: 'System error: apiKey does not match the bearer token' };
    }
    return this.external.updateVisit(req.tenantId, body);
  }

  @Post('external/cancelVisit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a visit',
    description:
      'For the two cases worth cancelling: a clinician refused the prescription, or the pharmacy ' +
      'rejected the order. Either way the patient is waiting on something that will never arrive.' +
      '\n\nAny prescription still live is voided and any order a pharmacy could still pick up is ' +
      'withdrawn. A visit whose medication has already shipped is refused with `ALREADY_SHIPPED` — ' +
      'the parcel is real and the record has to agree with it.\n\nThe reason is written to the ' +
      'audit log, so it is required.',
  })
  @ApiZodBody(CancelVisitDto)
  @ApiZodOk(
    z.object({ status: z.enum(EXTERNAL_STATUSES), info: z.string() }),
    'Processed. Read `status` for the outcome.',
  )
  @ApiResponse({ status: 400, description: 'A field was missing, empty, or the wrong type.' })
  async externalCancelVisit(@Body() body: CancelVisitDto, @Req() req: PartnerRequest) {
    if (!this.keyMatches(body.apiKey, req)) {
      return { status: 'GENERIC', info: 'System error: apiKey does not match the bearer token' };
    }
    return this.external.cancelVisit(req.tenantId, body);
  }

  @Get('patient/externalFetch/:phone')
  @ApiParam({ name: 'phone', description: 'Ten digits, no punctuation.', example: '5125550142' })
  @ApiOperation({
    summary: 'Look up a patient by phone number',
    description:
      'Scoped to your account. The same person may exist under another client on the same number ' +
      'and you will not see their record of them.\n\nEvery call is written to the audit log as a ' +
      'read of that patient.',
  })
  @ApiResponse({ status: 200, description: 'The patient, or `{ status: 400, error }` if unknown.' })
  async patientLookup(@Param('phone') phone: string, @Req() req: PartnerRequest) {
    if (!/^\d{10}$/.test(phone)) {
      return { status: 400, error: 'Phone number must be exactly ten digits' };
    }

    const data = await this.lookups.patientByPhone(req.tenantId, phone);
    if (!data) return { status: 400, error: 'Patient not found' };
    return { status: 200, data };
  }

  @Get('visit/externalFetch/:masterId')
  @ApiParam({ name: 'masterId', description: 'Your own order id, as sent on the visit.' })
  @ApiOperation({
    summary: 'Look up a visit by your order id',
    description:
      'The whole visit: its status, the intake the patient filled in, any lab results, and every ' +
      'prescription written on it in order.\n\n`visitStatus` is deliberately coarser than our ' +
      'internal one — a visit waiting to be assigned and one sitting in a clinician\u2019s queue ' +
      'are both `pending` from outside.\n\nEvery call is written to the audit log as a read of ' +
      'that patient.',
  })
  @ApiResponse({ status: 200, description: 'The visit, or `{ status: 400, error }` if unknown.' })
  async visitLookup(@Param('masterId') masterId: string, @Req() req: PartnerRequest) {
    const data = await this.lookups.visitByMasterId(req.tenantId, masterId);
    if (!data) return { status: 400, error: 'Visit not found' };
    return { status: 200, ...data };
  }

  /**
   * Lookup: what one pharmacy actually carries.
   *
   * This is the list a client's order form should be built from. Intake refuses
   * a `medId` the named pharmacy does not stock, so offering a patient anything
   * outside this list produces a rejected visit.
   */
  @Get('pharmacies/:pharmacyId/medications')
  async pharmacyMedications(@Param('pharmacyId') pharmacyId: string, @Req() req: PartnerRequest) {
    const pharmacy = await this.entitlements.resolvePharmacy(req.tenantId, pharmacyId);
    if (!pharmacy) return { status: 400, error: PartnerError.PHARMACY_MISMATCH };

    return {
      status: 200,
      data: await this.entitlements.catalogueAt(pharmacy.id),
    };
  }

  /**
   * Lookup: the photos on a visit.
   *
   * Metadata by default; pass `?include=data` for base64 bytes. Kept off the
   * visit lookup by default because a client polling status every minute should
   * not be made to download several megabytes of identification each time.
   */
  @Get('visit/:visitId/photos')
  async visitPhotoList(
    @Param('visitId') visitId: string,
    @Query('include') include: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    const data = await this.photos.list(req.tenantId, visitId, { includeData: include === 'data' });
    return { status: 200, data };
  }

  /** Lookup: one visit, scoped to the calling tenant by the Prisma extension. */
  @Get('visit/:masterId')
  async visit(@Param('masterId') masterId: string, @Req() req: PartnerRequest) {
    const request = await this.prisma.raw.prescriptionRequest.findFirst({
      // Withdrawn visits read as absent. The client asked for it to be removed;
      // an endpoint that keeps returning it is not honouring that.
      where: { tenantId: req.tenantId, externalMasterId: masterId, voidedAt: null },
      include: {
        items: true,
        prescriptions: { select: { id: true, status: true, signedAt: true } },
      },
    });

    if (!request) return { status: 404, error: 'Visit not found' };

    return {
      status: 200,
      data: {
        masterId,
        visitId: request.id,
        status: request.status,
        decidedAt: request.decidedAt,
        items: request.items.map((item) => ({
          name: item.nameText,
          decision: item.decision,
          approvedQuantity: item.approvedQuantity,
          approvedRefills: item.approvedRefills,
        })),
        prescriptions: request.prescriptions,
        // Metadata only. The bytes come from the photos lookup, so this stays
        // cheap enough to poll.
        photos: await this.photos.list(req.tenantId, request.id),
      },
    };
  }
}
