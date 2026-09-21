import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Role } from '@health-emr/types';
import type { AuthenticatedUser } from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiStandardErrors, ApiZodBody } from '@/shared/http/api-docs';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { LifeFileService } from './lifefile/lifefile.service';
import { PharmacyCredentialResolver } from './lifefile/credentials';

const integrationSchema = z
  .object({
    /** Where LifeFile lives for this pharmacy. `/order` is appended. */
    baseUrl: z.string().trim().url().max(500),
    /**
     * The *name* of the secret holding the username and password — never the
     * credentials themselves. Nothing that can authenticate is stored here.
     */
    credentialRef: z.string().trim().min(2).max(255).default('inline'),
    /**
     * The pharmacy's LifeFile login. Optional on update: omitting it leaves
     * whatever is already stored, so saving a change to the base URL does not
     * require re-entering the password.
     */
    username: z.string().trim().min(1).max(200).optional(),
    password: z.string().min(1).max(400).optional(),
    vendorId: z.string().trim().max(40).nullable().optional(),
    locationId: z.string().trim().max(40).nullable().optional(),
    apiNetworkId: z.string().trim().max(40).nullable().optional(),
    practiceId: z.string().trim().max(40).nullable().optional(),
    defaultShippingService: z.string().trim().max(40).nullable().optional(),
    timeoutMs: z.number().int().min(1000).max(60_000).default(20_000),
    isEnabled: z.boolean().default(false),
  })
  .strict();

class IntegrationDto extends createZodDto(integrationSchema) {}

/**
 * A pharmacy's outbound integration.
 *
 * Super Admin only: this decides where a signed prescription is transmitted, so
 * it is not something a pharmacy sets for itself. Credentials are referenced by
 * name and resolved at send time — this endpoint never accepts, stores or
 * returns a password.
 */
@ApiTags('system: pharmacies')
@Roles(Role.SUPER_ADMIN)
@ApiStandardErrors()
@Controller({ path: 'super-admin/pharmacies/:pharmacyId/integration', version: '1' })
export class IntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifefile: LifeFileService,
    private readonly credentials: PharmacyCredentialResolver,
  ) {}

  @Get()
  @ApiParam({ name: 'pharmacyId', format: 'uuid' })
  @ApiOperation({
    summary: 'How orders reach this pharmacy',
    description:
      'The connection settings and whether the credentials behind `credentialRef` currently resolve. ' +
      'The credentials themselves are never returned.',
  })
  async get(@Param('pharmacyId', ParseUUIDPipe) pharmacyId: string) {
    const pharmacy = await this.prisma.raw.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true, name: true, platform: true, config: true },
    });
    if (!pharmacy) return { configured: false, config: null };

    const config = pharmacy.config;
    const resolved = config
      ? Boolean(await this.credentials.resolve(config.credentialRef, config.credentialCipher))
      : false;

    const [lastOrder, failures] = await Promise.all([
      this.prisma.raw.pharmacyOrder.findFirst({
        where: { pharmacyId, submittedAt: { not: null } },
        orderBy: { submittedAt: 'desc' },
        select: { id: true, submittedAt: true, externalOrderId: true, externalRxNumber: true },
      }),
      this.prisma.raw.pharmacyOrder.count({ where: { pharmacyId, lastError: { not: null } } }),
    ]);

    return {
      configured: Boolean(config),
      platform: pharmacy.platform,
      config: config
        ? {
            baseUrl: config.baseUrl,
            credentialRef: config.credentialRef,
            vendorId: config.vendorId,
            locationId: config.locationId,
            apiNetworkId: config.apiNetworkId,
            practiceId: config.practiceId,
            defaultShippingService: config.defaultShippingService,
            timeoutMs: config.timeoutMs,
            isEnabled: config.isEnabled,
            /** Whether a password is on file. Never the password. */
            hasStoredCredentials: Boolean(config.credentialCipher),
          }
        : null,
      /** Whether the named secret is present. Not what it contains. */
      credentialsResolve: resolved,
      credentialEnvKey: config ? this.credentials.envKeyFor(config.credentialRef) : null,
      lastSubmitted: lastOrder,
      ordersWithErrors: failures,
    };
  }

  @Put()
  @ApiParam({ name: 'pharmacyId', format: 'uuid' })
  @ApiOperation({
    summary: 'Configure how orders reach this pharmacy',
    description:
      'Switching `isEnabled` on is what allows a signed prescription to leave the platform, so it is ' +
      'deliberately separate from filling in the settings.',
  })
  @ApiZodBody(IntegrationDto)
  async put(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Body() body: IntegrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const before = await this.prisma.raw.pharmacyConfig.findUnique({ where: { pharmacyId } });
    const { username, password, ...settings } = body;

    if ((username && !password) || (password && !username)) {
      throw new BadRequestException('Give both a username and a password, or neither to keep the stored one');
    }

    // Sealed here and never again in plaintext. An update that omits them keeps
    // what is already stored, so editing a URL does not mean retyping a secret.
    const credentialCipher =
      username && password ? this.credentials.seal(username, password) : undefined;

    const config = await this.prisma.raw.pharmacyConfig.upsert({
      where: { pharmacyId },
      create: { pharmacyId, authStrategy: 'BASIC', ...settings, credentialCipher },
      update: { ...settings, ...(credentialCipher ? { credentialCipher } : {}) },
    });

    if (credentialCipher) {
      await this.prisma.raw.pharmacy.update({ where: { id: pharmacyId }, data: { platform: 'LIFEFILE' } });
    }

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'PharmacyConfig',
      entityId: config.id,
      actorUserId: user.id,
      before: before ? snapshot(before) : null,
      after: snapshot(config),
    });

    return snapshot(config);
  }

  @Post('orders/:orderId/retry')
  @ApiParam({ name: 'pharmacyId', format: 'uuid' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOperation({
    summary: 'Retry a transmission',
    description:
      'For an order the pharmacy did not accept. An order they already accepted is returned ' +
      'unchanged rather than sent twice — resending one is how a patient receives two parcels. ' +
      'A rejection for a bad payload will be rejected again, so fix the cause first; the recorded ' +
      'error says what it was.',
  })
  retry(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.lifefile.transmit(orderId);
  }
}

/** What an audit entry carries. Never the credential, only its name. */
function snapshot(config: {
  baseUrl: string;
  credentialRef: string;
  vendorId: string | null;
  locationId: string | null;
  apiNetworkId: string | null;
  practiceId: string | null;
  defaultShippingService: string | null;
  timeoutMs: number;
  isEnabled: boolean;
  credentialCipher?: string | null;
}) {
  return {
    // Only that credentials exist, never what they are.
    hasStoredCredentials: Boolean(config.credentialCipher),
    baseUrl: config.baseUrl,
    credentialRef: config.credentialRef,
    vendorId: config.vendorId,
    locationId: config.locationId,
    apiNetworkId: config.apiNetworkId,
    practiceId: config.practiceId,
    defaultShippingService: config.defaultShippingService,
    timeoutMs: config.timeoutMs,
    isEnabled: config.isEnabled,
  };
}
