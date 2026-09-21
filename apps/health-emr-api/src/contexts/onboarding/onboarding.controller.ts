import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '@/shared/storage/upload.validation';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { Res } from '@nestjs/common';
import type { AuthenticatedUser } from '@health-emr/types';
import {
  PHARMACY_DOCUMENT_LABELS,
  PROVIDER_DOCUMENT_LABELS,
  Role,
  applicationFilterSchema,
  pharmacyApplicationSchema,
  providerApplicationSchema,
  reviewDecisionSchema,
} from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Public } from '@/shared/auth/decorators/public.decorator';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import {
  ApiKeysetOk,
  ApiKeysetQuery,
  ApiListOk,
  ApiStandardErrors,
  ApiZodBody,
  ApiZodOk,
} from '@/shared/http/api-docs';
import { OnboardingService } from './onboarding.service';
import { columnFilterShape } from '@/shared/http/column-filters';
import {
  PHARMACY_APPLICATION_FILTERS,
  PROVIDER_APPLICATION_FILTERS,
} from './onboarding.service';

class PharmacyApplicationDto extends createZodDto(pharmacyApplicationSchema) {}
class ProviderApplicationDto extends createZodDto(providerApplicationSchema) {}
// One inbox component serves both applications, so the DTO accepts the column
// filters of each; the service applies only its own map.
const applicationListSchema = applicationFilterSchema
  .extend(columnFilterShape(PROVIDER_APPLICATION_FILTERS))
  .extend(columnFilterShape(PHARMACY_APPLICATION_FILTERS));
class ApplicationFilterDto extends createZodDto(applicationListSchema) {}
class ReviewDecisionDto extends createZodDto(reviewDecisionSchema) {}

const submissionReceipt = z.object({
  applicationId: z.string().uuid(),
  submittedAt: z.string(),
  requiredDocuments: z.array(z.string()),
});

const documentChecklistItem = z.object({ kind: z.string(), label: z.string() });

/**
 * The public onboarding forms behind the landing page.
 *
 * These are the only unauthenticated write endpoints in the system, so they are
 * the most exposed surface we have: strictly rate limited, `.strict()` schemas
 * that reject any unexpected field, and no field that could confer status — an
 * applicant cannot submit themselves as approved.
 */
@ApiTags('public: onboarding')
@Public()
@Controller({ path: 'public/onboarding', version: '1' })
export class PublicOnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('documents/pharmacy')
  @ApiOperation({
    summary: 'Document checklist for the pharmacy form',
    description:
      'Every document kind with a human label. Which are mandatory depends on the applicant and is ' +
      'returned with the submission receipt.',
  })
  @ApiListOk(documentChecklistItem)
  pharmacyDocuments() {
    return {
      data: Object.entries(PHARMACY_DOCUMENT_LABELS).map(([kind, label]) => ({ kind, label })),
    };
  }

  @Get('documents/provider')
  @ApiOperation({
    summary: 'Document checklist for the provider form',
    description: 'Every document kind with a human label, for rendering the upload list.',
  })
  @ApiListOk(documentChecklistItem)
  providerDocuments() {
    return {
      data: Object.entries(PROVIDER_DOCUMENT_LABELS).map(([kind, label]) => ({ kind, label })),
    };
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Treatment areas a clinician can offer',
    description:
      'For the multi-select on the application form. Public, like the rest of the form — an ' +
      'applicant has no account yet, and the list of things this platform treats is not a secret.',
  })
  @ApiListOk(z.object({ slug: z.string(), name: z.string() }))
  async categories() {
    return { data: await this.onboarding.treatmentAreas() };
  }

  @Post('pharmacy')
  @HttpCode(201)
  // Three submissions per hour per IP. Generous for a human filling a long form,
  // hostile to a script.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Apply as a pharmacy',
    description:
      'Returns the application id and the documents required for this applicant, which depend on ' +
      'whether they compound, operate as a 503B outsourcing facility, and which states they ship into.',
  })
  @ApiZodBody(PharmacyApplicationDto)
  @ApiZodOk(submissionReceipt, 'Application received')
  @ApiStandardErrors()
  applyPharmacy(@Body() body: PharmacyApplicationDto, @Req() req: Request) {
    return this.onboarding.submitPharmacy(body, req.ip);
  }

  @Post('provider')
  @HttpCode(201)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Apply as a provider',
    description:
      'State licences are required and drive routing once approved: a request is only ever offered ' +
      'to a provider holding a current licence in the state the patient was in at submission.',
  })
  @ApiZodBody(ProviderApplicationDto)
  @ApiZodOk(submissionReceipt, 'Application received')
  @ApiStandardErrors()
  applyProvider(@Body() body: ProviderApplicationDto, @Req() req: Request) {
    return this.onboarding.submitProvider(body, req.ip);
  }

  @Post('pharmacy/:id/documents')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Application id from the submission receipt' })
  @ApiOperation({
    summary: 'Attach a document to a pharmacy application',
    description:
      'PDF, PNG or JPEG up to 15MB. Contents are checked against the extension, so a file merely ' +
      'named .pdf is rejected. The application id acts as the credential — an applicant has no ' +
      'account yet — so it is unguessable, rate limited, write-only, and refused once a decision ' +
      'has been made.',
  })
  @ApiStandardErrors()
  uploadPharmacyDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Attach a file');
    if (!body.kind) throw new BadRequestException('Say which document this is');
    return this.onboarding.attachPharmacyDocument(id, body as never, file);
  }

  @Post('provider/:id/documents')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Attach a document to a provider application',
    description:
      'Send `state` alongside a STATE_MEDICAL_LICENSE so accepting it verifies that state licence — ' +
      'which is what lets routing trust it.',
  })
  @ApiStandardErrors()
  uploadProviderDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Attach a file');
    if (!body.kind) throw new BadRequestException('Say which document this is');
    return this.onboarding.attachProviderDocument(id, body as never, file);
  }
}

const pharmacyApplicationRow = z.object({
  id: z.string().uuid(),
  legalName: z.string(),
  tradingName: z.string().nullable(),
  contactEmail: z.string(),
  state: z.string(),
  statesServed: z.array(z.string()),
  status: z.string(),
  createdAt: z.string(),
});

const providerApplicationRow = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  credentials: z.string(),
  npi: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

/** The Super Admin review queue. */
@ApiTags('system: onboarding')
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'super-admin/onboarding', version: '1' })
export class OnboardingReviewController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('pharmacies')
  @ApiOperation({
    summary: 'Pharmacy applications',
    description:
      'Keyset-paginated. Filter by status, a state they serve, submission date range, or free text ' +
      'across legal name, trading name and contact email.',
  })
  @ApiKeysetQuery()
  @ApiKeysetOk(pharmacyApplicationRow)
  @ApiStandardErrors()
  listPharmacies(@Query() filter: ApplicationFilterDto) {
    return this.onboarding.listPharmacyApplications(filter);
  }

  @Get('providers')
  @ApiOperation({
    summary: 'Provider applications',
    description:
      'Keyset-paginated. Filter by status, a state they hold a licence in, submission date range, ' +
      'or free text across name, email and NPI.',
  })
  @ApiKeysetQuery()
  @ApiKeysetOk(providerApplicationRow)
  @ApiStandardErrors()
  listProviders(@Query() filter: ApplicationFilterDto) {
    return this.onboarding.listProviderApplications(filter);
  }

  @Post('pharmacies/:id/decision')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Decide a pharmacy application',
    description:
      'Approval provisions the Pharmacy record, created inactive until credentials are attached. ' +
      'Approval is refused while any required document is unaccepted.',
  })
  @ApiZodBody(ReviewDecisionDto)
  @ApiStandardErrors()
  decidePharmacy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboarding.decidePharmacy(id, user.id, body);
  }

  @Post('providers/:id/decision')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Decide a provider application',
    description:
      'Approval provisions the ProviderProfile and its state licences, both created inactive. ' +
      'Approval is refused while any claimed licence is unverified, because routing trusts these rows.',
  })
  @ApiZodBody(ReviewDecisionDto)
  @ApiStandardErrors()
  decideProvider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboarding.decideProvider(id, user.id, body);
  }

  @Get(':scope/:id')
  @ApiParam({ name: 'scope', enum: ['pharmacy', 'provider'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One application in full',
    description:
      'Everything the reviewer needs on one screen: the submission, the claimed licences, the ' +
      'uploaded documents and which of them are still required.',
  })
  @ApiStandardErrors()
  application(@Param('scope') scope: string, @Param('id', ParseUUIDPipe) id: string) {
    if (scope !== 'pharmacy' && scope !== 'provider') {
      throw new BadRequestException('scope must be pharmacy or provider');
    }
    return this.onboarding.getApplication(scope, id);
  }

  @Get(':scope/documents/:documentId/file')
  @ApiParam({ name: 'scope', enum: ['pharmacy', 'provider'] })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'View an uploaded document',
    description:
      'Streams the file for inline preview. Served only to an authenticated reviewer, never from a ' +
      'public URL, and each read is written to the audit log — these are photo IDs and licences ' +
      'belonging to real people.',
  })
  @ApiStandardErrors()
  async documentFile(
    @Param('scope') scope: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (scope !== 'pharmacy' && scope !== 'provider') {
      throw new BadRequestException('scope must be pharmacy or provider');
    }

    const file = await this.onboarding.readDocument(scope, documentId);

    res.setHeader('Content-Type', file.mime);
    // `inline` so the reviewer previews it in place rather than downloading;
    // the filename is quoted because a document name can contain anything.
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    // Never cached by an intermediary — this is PHI on the wire.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  }

  @Get(':scope/:id/documents')
  @ApiParam({ name: 'scope', enum: ['pharmacy', 'provider'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Documents on an application',
    description: 'Metadata and review state. File contents are fetched separately, per document.',
  })
  @ApiStandardErrors()
  async documents(
    @Param('scope') scope: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (scope !== 'pharmacy' && scope !== 'provider') {
      throw new BadRequestException('scope must be pharmacy or provider');
    }
    return { data: await this.onboarding.listDocuments(scope, id) };
  }

  @Post(':scope/:id/documents')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'scope', enum: ['pharmacy', 'provider'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Upload a document on an applicant’s behalf',
    description:
      'For the ordinary case where a certificate arrives by email or fax rather than through the ' +
      'form. Recorded against the Super Admin who uploaded it, so a reviewer can see the document ' +
      'did not come from the applicant. Send `state` with a STATE_MEDICAL_LICENSE, or accepting it ' +
      'verifies nothing.',
  })
  @ApiStandardErrors()
  uploadForApplicant(
    @Param('scope') scope: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, string>,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (scope !== 'pharmacy' && scope !== 'provider') {
      throw new BadRequestException('scope must be pharmacy or provider');
    }
    if (!file) throw new BadRequestException('Attach a file');
    if (!body.kind) throw new BadRequestException('Say which document this is');

    const input = { ...body, uploadedByUserId: user.id } as never;
    return scope === 'pharmacy'
      ? this.onboarding.attachPharmacyDocument(id, input, file)
      : this.onboarding.attachProviderDocument(id, input, file);
  }

  @Post('providers/:id/licences/:licenceId/verify')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'licenceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Verify a state licence by hand',
    description:
      'For when there is no certificate to accept — the state board is checkable online, or the ' +
      'document arrived outside the system. Requires a note saying what was checked and where, ' +
      'because routing relies on this to decide a clinician may prescribe into that state. ' +
      'Refused on an expired licence.',
  })
  @ApiStandardErrors()
  verifyLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('licenceId', ParseUUIDPipe) licenceId: string,
    @Body() body: { note?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const note = body?.note?.trim() ?? '';
    if (note.length < 10) {
      throw new BadRequestException(
        'Say what you checked and where — at least 10 characters. This is the whole audit trail.',
      );
    }
    return this.onboarding.verifyLicence(id, licenceId, user.id, note);
  }

  @Post('providers/:id/licences/:licenceId/unverify')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'licenceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Withdraw a licence verification',
    description: 'Undoes a verification made in error. An unverified licence simply blocks approval.',
  })
  @ApiStandardErrors()
  unverifyLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('licenceId', ParseUUIDPipe) licenceId: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const reason = body?.reason?.trim() ?? '';
    if (reason.length < 10) throw new BadRequestException('Say why, in at least 10 characters');
    return this.onboarding.unverifyLicence(id, licenceId, user.id, reason);
  }

  @Post(':scope/documents/:documentId/review')
  @HttpCode(200)
  @ApiParam({ name: 'scope', enum: ['pharmacy', 'provider'] })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Accept or reject one document',
    description:
      'Accepting a STATE_MEDICAL_LICENSE also marks that state licence verified, which is the gate ' +
      'that lets the application be approved and the licence gate routing.',
  })
  @ApiStandardErrors()
  reviewDocument(
    @Param('scope') scope: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: { decision: 'ACCEPTED' | 'REJECTED'; notes?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (scope !== 'pharmacy' && scope !== 'provider') {
      throw new BadRequestException('scope must be pharmacy or provider');
    }
    if (body?.decision !== 'ACCEPTED' && body?.decision !== 'REJECTED') {
      throw new BadRequestException('decision must be ACCEPTED or REJECTED');
    }
    return this.onboarding.reviewDocument(scope, documentId, user.id, body.decision, body.notes);
  }
}
