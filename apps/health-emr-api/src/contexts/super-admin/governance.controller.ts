import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser, ReportKind } from '@health-emr/types';
import {
  REPORT_KINDS,
  Role,
  activityQuerySchema,
  archiveSchema,
  invoiceQuerySchema,
  issueInvoiceSchema,
  recordPaymentSchema,
  reportQuerySchema,
  adminVisitPatchSchema,
  issueApiKeySchema,
  rosterSchema,
  voidVisitSchema,
  updateProviderSchema,
  providerLicenceInputSchema,
  providerLicenceUpdateSchema,
  updateTenantSchema,
  createWebhookSchema,
  updateWebhookSchema,
} from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiStandardErrors, ApiZodBody, ApiZodOk } from '@/shared/http/api-docs';
import { ActivityService } from './activity.service';
import { GovernanceService } from './governance.service';
import { TenantProfileService } from './tenant-profile.service';
import { BillingService, toCsv } from './billing.service';
import { RerouteService } from '@/contexts/pharmacy/reroute.service';
import { ProviderLicencesService } from '@/contexts/practitioners/provider-licences.service';
import { ManualAssignmentService } from '@/contexts/practitioners/manual-assignment.service';
import { ProviderActivityService } from '@/contexts/practitioners/provider-activity.service';
import { PermanentDeleteService, type Kind } from './permanent-delete.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { RequiresPermission } from '@/shared/auth/decorators/permissions.decorator';
import { PlatformPermission } from '@health-emr/types';
import { activityQuerySchema as providerActivityQuerySchema } from '@/contexts/practitioners/activity-query';
import { StuckOrderService } from './stuck-orders.service';
import { ApiAccessService } from '@/contexts/tenancy/api-access.service';
import { WebhookAdminService } from '@/contexts/webhooks/webhook-admin.service';
import { VisitVoidService } from './visit-void.service';
import { columnFilterShape } from '@/shared/http/column-filters';
import { ACTIVITY_FILTERS } from './activity.service';
import { INVOICE_FILTERS } from './billing.service';

// Extended here rather than in the shared schema: the filterable columns are a
// property of this endpoint's service, and a client package has no business
// knowing them.
const activityListSchema = activityQuerySchema.extend(columnFilterShape(ACTIVITY_FILTERS));
class ActivityQueryDto extends createZodDto(activityListSchema) {}
class ArchiveDto extends createZodDto(archiveSchema) {}
class UpdateTenantDto extends createZodDto(updateTenantSchema) {}
class UpdateProviderDto extends createZodDto(updateProviderSchema) {}
class ProviderLicenceDto extends createZodDto(providerLicenceInputSchema) {}
const assignVisitSchema = z
  .object({
    providerId: z.string().uuid(),
    // Required, not optional: this overrides an automated clinical routing
    // decision, and "why" is the only thing that makes it reviewable later.
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
class AssignVisitDto extends createZodDto(assignVisitSchema) {}
class ProviderActivityQueryDto extends createZodDto(providerActivityQuerySchema) {}

const permanentDeleteSchema = z
  .object({
    // Ten characters, because this is the record of why something was erased
    // and "cleanup" answers nobody's question a year from now.
    reason: z.string().trim().min(10, 'Say why, in a sentence').max(500),
    /**
     * Take the account's staff logins with it.
     *
     * Consent rather than authority — the caller already holds ACCOUNTS_DELETE
     * to be here. What this records is that they were shown which logins would
     * go and agreed. Absent means no, and the deletion is refused instead.
     */
    removeStaffAccounts: z.boolean().optional(),
  })
  .strict();
class PermanentDeleteDto extends createZodDto(permanentDeleteSchema) {}

/** The two clinical records with their own delete rules, named as in the URL. */
const RECORD_KINDS = ['visit', 'prescription'] as const;

function asRecordKind(kind: string): (typeof RECORD_KINDS)[number] {
  if (!(RECORD_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequestException(`Unknown record kind "${kind}"`);
  }
  return kind as (typeof RECORD_KINDS)[number];
}

/** The three things that can be erased, named as they are in the URL. */
const DELETABLE = ['tenant', 'provider', 'pharmacy'] as const;
class ProviderLicencePatchDto extends createZodDto(providerLicenceUpdateSchema) {}
class RosterDto extends createZodDto(rosterSchema) {}
const invoiceListSchema = invoiceQuerySchema.extend(columnFilterShape(INVOICE_FILTERS));
class InvoiceQueryDto extends createZodDto(invoiceListSchema) {}
class CreateWebhookDto extends createZodDto(createWebhookSchema) {}
class UpdateWebhookDto extends createZodDto(updateWebhookSchema) {}
class IssueInvoiceDto extends createZodDto(issueInvoiceSchema) {}
class RecordPaymentDto extends createZodDto(recordPaymentSchema) {}
class ReportQueryDto extends createZodDto(reportQuerySchema) {}

const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
class PeriodDto extends createZodDto(periodSchema) {}

const rerouteSchema = z.object({
  pharmacyId: z.string().uuid(),
  /**
   * Move an order whose medication has already gone out.
   *
   * Refused without it, because rerouting raises a second dispatch rather than
   * diverting the first. Set when that is the intention — a parcel lost in
   * transit, or one that never arrived.
   */
  force: z.boolean().optional(),
  reason: z
    .string()
    .trim()
    .min(10, 'Say why this is being moved — it is written to the audit log')
    .max(500),
});
class RerouteDto extends createZodDto(rerouteSchema) {}

const bulkRerouteSchema = z.object({
  prescriptionIds: z.array(z.string().uuid()).min(1).max(200),
  pharmacyId: z.string().uuid(),
  /** As above. Applies to every prescription in the batch. */
  force: z.boolean().optional(),
  reason: z
    .string()
    .trim()
    .min(10, 'Say why these are being moved — it is written to the audit log')
    .max(500),
});
class BulkRerouteDto extends createZodDto(bulkRerouteSchema) {}
class IssueApiKeyDto extends createZodDto(issueApiKeySchema) {}
class VoidVisitDto extends createZodDto(voidVisitSchema) {}
class AdminVisitPatchDto extends createZodDto(adminVisitPatchSchema) {}

/**
 * The platform owner's write surface, its accountability trail, and its books.
 *
 * Separated from the read-only console controller because the risk profile is
 * different: everything here changes state, and every route records who did it,
 * to what, and why. Destructive routes take a reason and refuse without one.
 */
@ApiTags('super-admin')
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'super-admin', version: '1' })
export class GovernanceController {
  constructor(
    private readonly activity: ActivityService,
    private readonly governance: GovernanceService,
    private readonly profiles: TenantProfileService,
    private readonly billing: BillingService,
    private readonly reroute: RerouteService,
    private readonly orders: StuckOrderService,
    private readonly apiAccess: ApiAccessService,
    private readonly visits: VisitVoidService,
    private readonly licencesService: ProviderLicencesService,
    private readonly assignment: ManualAssignmentService,
    private readonly activityService: ProviderActivityService,
    private readonly permanent: PermanentDeleteService,
    private readonly records: ClinicalRecordsService,
    private readonly webhooks: WebhookAdminService,
  ) {}

  // ── activity ─────────────────────────────────────────────────────────────

  @Get('activity')
  @RequiresPermission(PlatformPermission.AUDIT_READ)
  @ApiOperation({
    summary: 'Who did what, and when',
    description:
      'The hash-chained audit trail, filterable by actor, action, entity, client account, patient and ' +
      'date range. Filtering by patient gives the accounting of disclosures HIPAA asks for.',
  })
  @ApiStandardErrors()
  listActivity(@Query() query: ActivityQueryDto) {
    return this.activity.list(query);
  }

  @Get('activity/integrity')
  @RequiresPermission(PlatformPermission.AUDIT_READ)
  @ApiOperation({
    summary: 'Verify the audit chain',
    description:
      'Recomputes every entry hash against the one before it. A false result means a row was altered ' +
      'or removed in the database directly, and is an incident rather than a warning.',
  })
  @ApiStandardErrors()
  integrity() {
    return this.activity.integrity();
  }

  @Get('activity/:entityType/:entityId')
  @RequiresPermission(PlatformPermission.AUDIT_READ)
  @ApiParam({ name: 'entityType', example: 'Pharmacy' })
  @ApiOperation({ summary: 'Everything that ever happened to one record' })
  @ApiStandardErrors()
  entityHistory(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.activity.forEntity(entityType, entityId);
  }

  // ── client businesses ────────────────────────────────────────────────────

  @Get('admins/:id/profile')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Everything about one client business',
    description:
      'Counts, pipeline, the pharmacies and clinicians serving them, top medications, revenue against ' +
      'cost of goods and provider fees, twelve months of volume, and the most recent prescriptions.',
  })
  @ApiStandardErrors()
  tenantProfile(@Param('id', ParseUUIDPipe) id: string, @Query() period: PeriodDto) {
    return this.profiles.profile(id, period);
  }

  // ── visits ───────────────────────────────────────────────────────────────

  @Delete('visits/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequiresPermission(PlatformPermission.RECORDS_DELETE)
  @ApiOperation({
    summary: 'Withdraw a visit',
    description:
      'For when a client business asks for a visit to be removed — a test submission, a duplicate, ' +
      'an order the patient disputed. It disappears from every list and every tile, and stops ' +
      'counting toward revenue, cost and profit for them and for us. Any provider fee on it is ' +
      'voided and any order still queued is cancelled.\n\n' +
      '**The row is kept.** A clinician may have read the chart; erasing it would leave that ' +
      'unexplained, and the audit trail is hash-chained so history cannot be quietly rewritten. ' +
      'What is recorded is who withdrew it, when, and why.\n\n' +
      '**A shipped visit is refused by default.** The medication reached a real patient at a real ' +
      'address. Raise a credit against the invoice instead — or send `force: true` with a reason ' +
      'if it genuinely has to go, in which case the audit entry records that it had shipped.\n\n' +
      'Only a SUPER_ADMIN may call this. The party whose numbers change is deliberately not the ' +
      'party who changes them.',
  })
  @ApiZodBody(VoidVisitDto)
  @ApiStandardErrors()
  voidVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoidVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.void(id, body.reason, user, body.force ?? false);
  }

  @Patch('visits/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Correct a visit',
    description:
      'Contact details, delivery address, the pharmacy it should be filled by, and the status — ' +
      'at any stage, including after a clinician has decided and after it has shipped.\n\n' +
      'Wider on purpose than the client\u2019s own update, which stops at the decision. The cases ' +
      'this exists for are the ones that arrive by telephone afterwards: a patient who moved, an ' +
      'order pointed at the wrong pharmacy, a status that has to catch up with something that ' +
      'happened outside the system.\n\n' +
      '**The questionnaire cannot be changed by anyone.** It is what the patient attested to, and ' +
      'an answer that can be rewritten afterwards is not evidence of anything.\n\n' +
      'The reason is required and both the old and new values go to the audit log.',
  })
  @ApiZodBody(AdminVisitPatchDto)
  @ApiStandardErrors()
  patchVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminVisitPatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.visits.patch(id, body, user);
  }

  @Get('visits/:id/candidates')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Who could take this visit',
    description:
      'Every active clinician, with the reason each one was passed over. Licence and credentialling ' +
      'are hard refusals; being at capacity is shown but does not disqualify, because overriding ' +
      'that is what this screen is for.',
  })
  @ApiStandardErrors()
  candidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignment.candidates(id);
  }

  @Post('visits/:id/assign')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Hand a waiting visit to a clinician',
    description:
      'For a visit nobody can take — no one is licensed in the patient’s state for that treatment, ' +
      'so retrying will never place it. Capacity is overridden; licence and credentialling are not, ' +
      'at any level of privilege. Recorded against the visit and in the audit log.',
  })
  @ApiZodBody(AssignVisitDto)
  @ApiStandardErrors()
  assignVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignment.assign(id, body.providerId, body.reason, user.id);
  }

  @Post('visits/:id/restore')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequiresPermission(PlatformPermission.RECORDS_DELETE)
  @ApiOperation({
    summary: 'Put a withdrawn visit back',
    description:
      'For a withdrawal made in error. The visit counts again from here on. A voided provider fee ' +
      'and a cancelled pharmacy order are not reinstated — whether to pay the clinician again, and ' +
      'whether the pharmacy should fill after all, are decisions a person makes.',
  })
  @ApiStandardErrors()
  restoreVisit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.visits.restore(id, user);
  }

  // ── outbound events ──────────────────────────────────────────────────────

  @Get('admins/:id/webhooks')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Where this client is told what happened',
    description:
      'Every endpoint registered for this account, what each subscribes to, and whether it is ' +
      'working. Never the bearer token: it belongs to the client and we hold it only to present ' +
      'it back to their endpoint.',
  })
  @ApiStandardErrors()
  listWebhooks(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.list(id);
  }

  @Post('admins/:id/webhooks')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Register an endpoint',
    description:
      'Points a client\'s own system at the events they choose — so their CRM can show a patient ' +
      'and a salesperson where a visit has got to without polling us.\n\n' +
      'Returns a signing secret once, and never again. Each request carries their bearer token, ' +
      'so their endpoint knows it is us, and a signature over the body, so they can prove it was ' +
      'not altered.',
  })
  @ApiZodBody(CreateWebhookDto)
  @ApiStandardErrors()
  createWebhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooks.create(id, body, { id: user.id, role: user.role });
  }

  @Patch('webhooks/:webhookId')
  @RequiresPermission(PlatformPermission.WEBHOOKS_MANAGE)
  @ApiParam({ name: 'webhookId', format: 'uuid' })
  @ApiOperation({
    summary: 'Change an endpoint',
    description:
      'Repoint it, change what it subscribes to, switch it on or off, or replace the bearer ' +
      'token. Omitting the token leaves the stored one alone. An endpoint the platform switched ' +
      'off starts being tried again.',
  })
  @ApiZodBody(UpdateWebhookDto)
  @ApiStandardErrors()
  updateWebhook(
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
    @Body() body: UpdateWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooks.update(webhookId, body, { id: user.id, role: user.role });
  }

  @Delete('webhooks/:webhookId')
  @RequiresPermission(PlatformPermission.WEBHOOKS_MANAGE)
  @ApiParam({ name: 'webhookId', format: 'uuid' })
  @ApiOperation({
    summary: 'Remove an endpoint',
    description: 'Stops sending to it and removes the record of what was sent.',
  })
  @ApiStandardErrors()
  removeWebhook(
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooks.remove(webhookId, { id: user.id, role: user.role });
  }

  @Post('webhooks/:webhookId/test')
  @HttpCode(200)
  @ApiParam({ name: 'webhookId', format: 'uuid' })
  @ApiOperation({
    summary: 'Send a test event',
    description:
      'Posts a `CONSULT_RECEIVED` carrying a placeholder masterId and reports what came back. It ' +
      'names no patient: the point is to prove the URL, the credential and the signature work, ' +
      'and doing that with real details would disclose them to whatever the URL turns out to be.',
  })
  @ApiStandardErrors()
  testWebhook(
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooks.test(webhookId, { id: user.id, role: user.role });
  }

  @Get('webhooks/:webhookId/deliveries')
  @ApiParam({ name: 'webhookId', format: 'uuid' })
  @ApiOperation({
    summary: 'What we sent this endpoint',
    description:
      'Each attempt with the body that went, their answer, and when the next try is due. This is ' +
      'the answer to "your events never reached us".',
  })
  @ApiStandardErrors()
  webhookDeliveries(@Param('webhookId', ParseUUIDPipe) webhookId: string) {
    return this.webhooks.deliveries(webhookId);
  }

  // ── integration credentials ──────────────────────────────────────────────

  @Get('admins/:id/api-access')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'How a client business authenticates to us',
    description:
      'Their company key, the base URL to post to, and every key ever issued to them — active, ' +
      'expired and withdrawn. Never the keys themselves; those exist only in the response that ' +
      'created them.',
  })
  @ApiStandardErrors()
  apiAccessFor(@Param('id', ParseUUIDPipe) id: string) {
    return this.apiAccess.overview(id);
  }

  @Post('admins/:id/api-keys')
  @RequiresPermission(PlatformPermission.API_KEYS_MANAGE)
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Issue an API key',
    description:
      'Mints the bearer token this client sends on every request. It is returned once, in this ' +
      'response, and is unrecoverable afterwards — only its hash is stored.\n\n' +
      'A key resolves to exactly one account, and intake refuses any visit whose `company` field ' +
      'disagrees with the key that carried it. That pairing is what makes a submission attributable.',
  })
  @ApiZodBody(IssueApiKeyDto)
  @ApiZodOk(
    z.object({
      id: z.string().uuid(),
      key: z.string().describe('The bearer token. Shown once. Copy it now.'),
      keyPrefix: z.string().describe('Non-secret. Identifies this key afterwards.'),
      companyKey: z.string().describe('What their backend must send as `company`.'),
      createdAt: z.string(),
    }),
    'The key was issued',
  )
  @ApiStandardErrors()
  issueApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IssueApiKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiAccess.issue(
      id,
      body.name,
      user,
      body.expiresAt ? new Date(body.expiresAt) : null,
    );
  }

  @Delete('admins/:id/api-keys/:keyId')
  @RequiresPermission(PlatformPermission.API_KEYS_MANAGE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'keyId', format: 'uuid' })
  @ApiOperation({
    summary: 'Delete an API key',
    description:
      'The key is removed from the account and from the database, and stops working immediately. ' +
      'Anything still sending it gets 401 on its next request.\n\n' +
      'The audit trail keeps a record that a key with this prefix existed and who deleted it — ' +
      'that table is append-only and separate, so removing the credential does not remove the ' +
      'history of it.',
  })
  @ApiStandardErrors()
  deleteApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiAccess.remove(id, keyId, user);
  }

  @Patch('admins/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a client business' })
  @ApiZodBody(UpdateTenantDto)
  @ApiStandardErrors()
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.updateTenant(id, body, user.id);
  }

  @Delete('admins/:id')
  @RequiresPermission(PlatformPermission.ACCOUNTS_ARCHIVE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Archive a client business',
    description:
      'Closes the account, deactivates its people and revokes its API keys. Nothing clinical or ' +
      'financial is deleted — those records are retained and the account can be restored.',
  })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  archiveTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.archiveTenant(id, body.reason, user.id);
  }

  @Post('admins/:id/restore')
  @RequiresPermission(PlatformPermission.ACCOUNTS_ARCHIVE)
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Restore an archived client business' })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  restoreTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.restoreTenant(id, body.reason, user.id);
  }

  @Post('admins/:id/roster')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Add a pharmacy or provider to a client’s roster' })
  @ApiZodBody(RosterDto)
  @ApiStandardErrors()
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RosterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.attachToTenant(id, body, user.id);
  }

  @Post('admins/:id/roster/remove')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Remove a pharmacy or provider from a client’s roster',
    description:
      'A clinician’s link is ended rather than deleted, so prescriptions they signed for this client ' +
      'stay explicable years later.',
  })
  @ApiZodBody(RosterDto)
  @ApiStandardErrors()
  detach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RosterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.detachFromTenant(id, body, user.id);
  }

  // ── clinicians ───────────────────────────────────────────────────────────

  @Patch('providers/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a provider' })
  @ApiZodBody(UpdateProviderDto)
  @ApiStandardErrors()
  updateProvider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProviderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.updateProvider(id, body, user.id);
  }

  // ── erasing a record ─────────────────────────────────────────────────────

  @Get('permanent-delete/:kind/:id')
  @ApiParam({ name: 'kind', enum: DELETABLE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Whether this can be erased, and what stops it',
    description:
      'Asked before the button is offered, so an administrator reads "31 visits refer to this" ' +
      'rather than discovering it by pressing delete. Nothing is changed.',
  })
  @RequiresPermission(PlatformPermission.ACCOUNTS_DELETE)
  @ApiStandardErrors()
  inspectDelete(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.permanent.inspect(asKind(kind), id, user);
  }

  @Delete('permanent-delete/:kind/:id')
  @ApiParam({ name: 'kind', enum: DELETABLE })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Erase a record permanently',
    description:
      'For the account created by mistake or the duplicate — not for one that has been used. ' +
      'Refused outright while any record of care or of money refers to it: a visit, prescription, ' +
      'encounter, intake questionnaire, conversation, pharmacy order, patient, invoice or ' +
      'clinician payment. Those are retained for years and this would cascade into them. ' +
      'Staff accounts are the one blocker that can be cleared, by passing removeStaffAccounts ' +
      'and holding the grant — and only for staff who wrote nothing clinical. Archiving is the ' +
      'answer in every other case.',
  })
  @RequiresPermission(PlatformPermission.ACCOUNTS_DELETE)
  @ApiZodBody(PermanentDeleteDto)
  @ApiStandardErrors()
  permanentDelete(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PermanentDeleteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.permanent.remove(
      asKind(kind),
      id,
      body.reason,
      user,
      body.removeStaffAccounts ?? false,
    );
  }

  // ── erasing a clinical record ────────────────────────────────────────────

  @Get('records/:kind/:id/deletion')
  @ApiParam({ name: 'kind', enum: ['visit', 'prescription'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Whether this record can be erased, and what stops it',
    description:
      'A visit a clinician has decided, and every prescription, can only be withdrawn. The ' +
      'answer carries the reason in the words to put on the disabled button, so the console ' +
      'never has to invent one. Nothing is changed.',
  })
  @RequiresPermission(PlatformPermission.RECORDS_DELETE)
  @ApiStandardErrors()
  inspectRecord(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return asRecordKind(kind) === 'visit'
      ? this.records.inspectVisit(id)
      : this.records.inspectPrescription(id);
  }

  @Delete('records/visit/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Erase a visit that never reached a clinician',
    description:
      'For the intake posted twice or abandoned halfway. Refused the moment anybody decided ' +
      'anything: approved, refused, prescribed or sent to a pharmacy. Its intake answers and ' +
      'encounter go with it, being the same event recorded three times.',
  })
  @RequiresPermission(PlatformPermission.RECORDS_DELETE)
  @ApiZodBody(PermanentDeleteDto)
  @ApiStandardErrors()
  removeVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PermanentDeleteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.records.removeVisit(id, body.reason, user);
  }

  @Delete('records/prescription/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Withdraw a prescription',
    description:
      'Marked as entered in error, hidden from the lists, and kept. A signed prescription is ' +
      'never erased — this is the whole of what can happen to one. Refused once it has shipped, ' +
      'because the chart would then contradict the dispensing record.',
  })
  @RequiresPermission(PlatformPermission.RECORDS_DELETE)
  @ApiZodBody(PermanentDeleteDto)
  @ApiStandardErrors()
  archivePrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PermanentDeleteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.records.archivePrescription(id, body.reason, user);
  }

  @Post('records/prescription/:id/restore')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Put a withdrawn prescription back',
    description: 'For when the withdrawal was itself the mistake.',
  })
  @RequiresPermission(PlatformPermission.RECORDS_DELETE)
  @ApiStandardErrors()
  restorePrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.records.restorePrescription(id, user);
  }

  // ── time worked ──────────────────────────────────────────────────────────

  @Get('activity/providers')
  @RequiresPermission(PlatformPermission.WORKFORCE_VIEW)
  @ApiOperation({
    summary: 'Hours worked, across the clinician roster',
    description:
      'Active time per clinician over the window, busiest first. Derived from recorded actions ' +
      'rather than from a session timer, so an idle browser counts for nothing.',
  })
  @ApiStandardErrors()
  providerActivity(@Query() query: ProviderActivityQueryDto) {
    return this.activityService.roster(query.days, query.timeZone);
  }

  @Get('providers/:id/activity')
  @RequiresPermission(PlatformPermission.WORKFORCE_VIEW)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'One clinician’s hours, day by day',
    description:
      'A day-by-day series for charting, plus totals. Days with no activity are present and zero, ' +
      'so the shape of the week is not flattened by omitting them.',
  })
  @ApiStandardErrors()
  oneProviderActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ProviderActivityQueryDto,
  ) {
    return this.activityService.forProvider(id, query.days, query.timeZone);
  }

  // ── state licences ───────────────────────────────────────────────────────

  @Get('providers/:id/licences')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'The states this clinician is licensed in',
    description: 'Soonest to expire first, so the ones needing attention are at the top.',
  })
  @ApiStandardErrors()
  licences(@Param('id', ParseUUIDPipe) id: string) {
    return this.licencesService.list(id);
  }

  @Post('providers/:id/licences')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Add a state licence',
    description:
      'Added by the platform, so it is ACTIVE immediately and the clinician can be routed visits ' +
      'in that state. A licence the clinician adds for themselves arrives PENDING instead.',
  })
  @ApiZodBody(ProviderLicenceDto)
  @ApiStandardErrors()
  addLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ProviderLicenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licencesService.add(id, body, user.id, true);
  }

  @Patch('providers/:id/licences/:licenceId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'licenceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Update a state licence',
    description:
      'Including its standing. Setting ACTIVE is what turns a licence the clinician added ' +
      'themselves into one that can be routed against.',
  })
  @ApiZodBody(ProviderLicencePatchDto)
  @ApiStandardErrors()
  updateLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('licenceId', ParseUUIDPipe) licenceId: string,
    @Body() body: ProviderLicencePatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licencesService.update(id, licenceId, body, user.id);
  }

  @Delete('providers/:id/licences/:licenceId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'licenceId', format: 'uuid' })
  @ApiOperation({
    summary: 'Remove a state licence',
    description:
      'For one entered in error. A licence that has lapsed should be marked EXPIRED rather than ' +
      'deleted, so the record still shows they once held it.',
  })
  @ApiStandardErrors()
  removeLicence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('licenceId', ParseUUIDPipe) licenceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licencesService.remove(id, licenceId, user.id);
  }

  @Delete('providers/:id')
  @RequiresPermission(PlatformPermission.ACCOUNTS_ARCHIVE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Archive a provider',
    description:
      'Refused while they hold open visits — archiving then would leave those patients waiting on ' +
      'somebody who can no longer act. Prescriptions they signed are retained.',
  })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  archiveProvider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.archiveProvider(id, body.reason, user.id);
  }

  @Post('providers/:id/restore')
  @RequiresPermission(PlatformPermission.ACCOUNTS_ARCHIVE)
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Restore an archived provider' })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  restoreProvider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.restoreProvider(id, body.reason, user.id);
  }

  // ── pharmacies ───────────────────────────────────────────────────────────

  @Delete('pharmacies/:id')
  @RequiresPermission(PlatformPermission.ACCOUNTS_ARCHIVE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Archive a pharmacy',
    description: 'Refused while orders are in flight — a patient is waiting on each one.',
  })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  archivePharmacy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.archivePharmacy(id, body.reason, user.id);
  }

  @Post('pharmacies/:id/restore')
  @RequiresPermission(PlatformPermission.ACCOUNTS_ARCHIVE)
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Restore an archived pharmacy' })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  restorePharmacy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.governance.restorePharmacy(id, body.reason, user.id);
  }

  // Catalog writes — categories, products and cost of goods — live with the
  // catalogue itself, in PharmacyCatalogController, which already owns these
  // paths and the retire-rather-than-delete rule they depend on.

  // ── stuck orders ─────────────────────────────────────────────────────────

  @Get('orders/stuck')
  @ApiOperation({
    summary: 'Orders that have not reached a pharmacy',
    description:
      'Anything queued with a transmission error, or sitting unsent. These are the ones where a ' +
      'patient is waiting on something nobody is working on.',
  })
  @ApiStandardErrors()
  stuckOrders() {
    return this.orders.stuck();
  }

  @Get('orders/:orderId/payload')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOperation({
    summary: 'What we sent the pharmacy, and what came back',
    description:
      'The exact request body posted to the pharmacy at transmission, the endpoint it went to, ' +
      'and their answer — the order id they gave it, or the error. Kept because a pharmacy ' +
      'disputing what it received is otherwise our word against theirs.\n\n' +
      'This is full PHI. Reading it is recorded as break-the-glass.',
  })
  @ApiStandardErrors()
  orderPayload(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.payload(orderId, { id: user.id, role: user.role });
  }

  @Get('orders/:orderId/reroute-options')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOperation({
    summary: 'Where else this order could go',
    description:
      'Every active pharmacy, each saying whether it can take this order and why not if it cannot — ' +
      'capability, and whether it stocks the kit.',
  })
  @ApiStandardErrors()
  rerouteOptions(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.reroute.candidatesFor(orderId);
  }

  @Post('orders/:orderId/reroute')
  @HttpCode(200)
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOperation({
    summary: 'Send a stuck order to a different pharmacy',
    description:
      'Cancels the order at the original pharmacy and raises a new one at the chosen pharmacy, then ' +
      'transmits it. Refused once the original has shipped. If the original pharmacy had already ' +
      'accepted it, the response says so — they must be told to cancel, or the patient gets two parcels.',
  })
  @ApiZodBody(RerouteDto)
  @ApiStandardErrors()
  rerouteOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: RerouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reroute.reroute(orderId, body.pharmacyId, body.reason, user.id, body.force);
  }

  @Post('prescriptions/reroute')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move several prescriptions to a different pharmacy',
    description:
      'For each, cancels the live order and raises a new one at the chosen pharmacy, then transmits. ' +
      'Each is attempted independently: one that has already shipped is skipped and reported rather ' +
      'than failing the batch. The response says what moved and what did not, and why.',
  })
  @ApiZodBody(BulkRerouteDto)
  @ApiStandardErrors()
  rerouteMany(@Body() body: BulkRerouteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reroute.rerouteMany(
      body.prescriptionIds,
      body.pharmacyId,
      body.reason,
      user.id,
      body.force,
    );
  }

  // ── billing ──────────────────────────────────────────────────────────────

  @Get('invoices')
  @RequiresPermission(PlatformPermission.FINANCE_VIEW)
  @ApiOperation({ summary: 'Invoices across every client business' })
  @ApiStandardErrors()
  listInvoices(@Query() query: InvoiceQueryDto) {
    return this.billing.list(query);
  }

  @Get('invoices/:id')
  @RequiresPermission(PlatformPermission.FINANCE_VIEW)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'One invoice, with its lines, payments and cost basis' })
  @ApiStandardErrors()
  getInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.get(id);
  }

  @Post('prescriptions/:id/invoice')
  @RequiresPermission(PlatformPermission.FINANCE_MANAGE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Raise a draft invoice for a prescription',
    description:
      'Built from the price the client quoted at intake. Refused if that prescription is already ' +
      'invoiced, and refused if no price was quoted — inventing one would be worse than raising nothing.',
  })
  @ApiStandardErrors()
  createInvoice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.createForPrescription(id, user.id);
  }

  @Post('invoices/:id/issue')
  @RequiresPermission(PlatformPermission.FINANCE_MANAGE)
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Issue a draft invoice' })
  @ApiZodBody(IssueInvoiceDto)
  @ApiStandardErrors()
  issueInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IssueInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.issue(id, body, user.id);
  }

  @Post('invoices/:id/void')
  @RequiresPermission(PlatformPermission.FINANCE_MANAGE)
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Void an invoice', description: 'Refused once paid — refund it instead.' })
  @ApiZodBody(ArchiveDto)
  @ApiStandardErrors()
  voidInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.void(id, body.reason, user.id);
  }

  @Post('invoices/:id/payments')
  @RequiresPermission(PlatformPermission.FINANCE_MANAGE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Record a payment',
    description: 'Settles the invoice when payments reach the total. Overpayment is refused.',
  })
  @ApiZodBody(RecordPaymentDto)
  @ApiStandardErrors()
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.recordPayment(id, body, user.id);
  }

  // ── reports ──────────────────────────────────────────────────────────────

  @Get('reports/:kind')
  @RequiresPermission(PlatformPermission.DATA_EXPORT)
  @ApiParam({ name: 'kind', enum: REPORT_KINDS })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'] })
  @ApiOperation({
    summary: 'Run a report',
    description:
      'Cost of goods by pharmacy, revenue by client, what each clinician is owed, or activity by ' +
      'client. Every cost report publishes its coverage, so a partial figure is never read as exact.',
  })
  @ApiStandardErrors()
  @Header('Cache-Control', 'no-store')
  async report(
    @Param('kind') kind: string,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const resolved = REPORT_KINDS.find((value) => value === kind);
    if (!resolved) {
      return { statusCode: 400, message: `Unknown report. Choose one of: ${REPORT_KINDS.join(', ')}` };
    }

    const result = await this.billing.report(resolved as ReportKind, query);

    if (query.format === 'csv') {
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="${resolved}.csv"`);
      return toCsv(result.rows as Array<Record<string, unknown>>);
    }
    return result;
  }
}

/**
 * The path segment, narrowed.
 *
 * `@ApiParam({ enum })` documents the values but does not enforce them, so the
 * check happens here rather than letting an unknown kind reach a switch that
 * would silently fall through to pharmacies.
 */
function asKind(value: string): Kind {
  if (!(DELETABLE as readonly string[]).includes(value)) {
    throw new BadRequestException(`Unknown kind. Expected one of: ${DELETABLE.join(', ')}`);
  }
  return value as Kind;
}
