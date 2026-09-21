import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Role } from '@health-emr/types';
import type { AuthenticatedUser } from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiStandardErrors, ApiZodBody } from '@/shared/http/api-docs';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { FulfilmentService } from './fulfilment.service';
import { PharmacyCredentialResolver } from './lifefile/credentials';

const profileSchema = z
  .object({
    contactEmail: z.string().trim().email().max(255).nullable().optional(),
    contactPhone: z.string().trim().max(30).nullable().optional(),
    ncpdpId: z.string().trim().max(40).nullable().optional(),
    statesServed: z.array(z.string().trim().length(2).toUpperCase()).max(60).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

const connectionSchema = z
  .object({
    baseUrl: z.string().trim().url().max(500),
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

class ProfileDto extends createZodDto(profileSchema) {}
class ConnectionDto extends createZodDto(connectionSchema) {}

/**
 * A pharmacy's own record and its connection to us.
 *
 * Deliberately narrower than what Super Admin can change. A pharmacy owns its
 * contact details, the states it ships into and the credentials for its own
 * system — nobody else can know those as well as they do, and making them ask
 * is how a catalogue or an endpoint goes stale.
 *
 * What it cannot change is what it is *allowed* to dispense. Compounded and
 * branded capability gate which prescriptions may be routed here at all, so
 * they stay with the platform: a pharmacy quietly marking itself able to fill
 * branded products would start receiving them.
 */
@ApiTags('dispensary')
@Roles(Role.PHARMACY)
@ApiStandardErrors()
@Controller({ path: 'dispensary', version: '1' })
export class DispensaryProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fulfilment: FulfilmentService,
    private readonly credentials: PharmacyCredentialResolver,
  ) {}

  @Get('profile')
  @ApiOperation({
    summary: 'My pharmacy',
    description: 'Contact details, what this pharmacy is permitted to dispense, and how it is doing.',
  })
  async profile(@CurrentUser() user: AuthenticatedUser) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);

    const [pharmacy, counts, shipped] = await Promise.all([
      this.prisma.raw.pharmacy.findUniqueOrThrow({
        where: { id: pharmacyId },
        select: {
          id: true, name: true, slug: true, contactEmail: true, contactPhone: true,
          ncpdpId: true, statesServed: true, dispensesCompounded: true, dispensesBranded: true,
          status: true, isActive: true, createdAt: true,
          _count: { select: { catalogProducts: true, catalogCategories: true, tenants: true } },
        },
      }),
      this.prisma.raw.pharmacyOrder.groupBy({
        by: ['status'],
        where: { pharmacyId },
        _count: { _all: true },
      }),
      this.prisma.raw.pharmacyOrder.count({ where: { pharmacyId, status: 'SHIPPED' } }),
    ]);

    return {
      ...pharmacy,
      createdAt: pharmacy.createdAt.toISOString(),
      catalogue: {
        categories: pharmacy._count.catalogCategories,
        products: pharmacy._count.catalogProducts,
      },
      clients: pharmacy._count.tenants,
      orders: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      shipped,
    };
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update my details',
    description:
      'Contact details and the states this pharmacy ships into. Dispensing capability is not here — ' +
      'it decides what may be routed to this pharmacy and stays with the platform.',
  })
  @ApiZodBody(ProfileDto)
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: ProfileDto) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    const before = await this.prisma.raw.pharmacy.findUniqueOrThrow({
      where: { id: pharmacyId },
      select: PROFILE_FIELDS,
    });

    const after = await this.prisma.raw.pharmacy.update({
      where: { id: pharmacyId },
      data: body,
      select: PROFILE_FIELDS,
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'Pharmacy',
      entityId: pharmacyId,
      actorUserId: user.id,
      before,
      after,
    });

    return after;
  }

  @Get('integration')
  @ApiOperation({
    summary: 'How orders reach my system',
    description:
      'The connection settings for this pharmacy, and whether a login is on file. The password is ' +
      'never returned — not even to the pharmacy that set it.',
  })
  async integration(@CurrentUser() user: AuthenticatedUser) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    const [pharmacy, config, failing] = await Promise.all([
      this.prisma.raw.pharmacy.findUniqueOrThrow({
        where: { id: pharmacyId },
        select: { name: true, platform: true },
      }),
      this.prisma.raw.pharmacyConfig.findUnique({ where: { pharmacyId } }),
      this.prisma.raw.pharmacyOrder.count({ where: { pharmacyId, lastError: { not: null } } }),
    ]);

    return {
      pharmacy: pharmacy.name,
      platform: pharmacy.platform,
      configured: Boolean(config),
      config: config ? publicConfig(config) : null,
      credentialsResolve: config
        ? Boolean(await this.credentials.resolve(config.credentialRef, config.credentialCipher))
        : false,
      ordersWithErrors: failing,
    };
  }

  @Put('integration')
  @ApiOperation({
    summary: 'Set how orders reach my system',
    description:
      'The endpoint, the routing ids and the login. Until transmission is switched on, orders wait ' +
      'in the fill queue and nothing is sent.',
  })
  @ApiZodBody(ConnectionDto)
  async setIntegration(@CurrentUser() user: AuthenticatedUser, @Body() body: ConnectionDto) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    const { username, password, ...settings } = body;

    const before = await this.prisma.raw.pharmacyConfig.findUnique({ where: { pharmacyId } });
    const credentialCipher =
      username && password ? this.credentials.seal(username, password) : undefined;

    const config = await this.prisma.raw.pharmacyConfig.upsert({
      where: { pharmacyId },
      create: {
        pharmacyId,
        authStrategy: 'BASIC',
        credentialRef: `pharmacy-${pharmacyId.slice(0, 8)}`,
        ...settings,
        credentialCipher,
      },
      update: { ...settings, ...(credentialCipher ? { credentialCipher } : {}) },
    });

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'PharmacyConfig',
      entityId: config.id,
      actorUserId: user.id,
      before: before ? publicConfig(before) : null,
      after: publicConfig(config),
    });

    return publicConfig(config);
  }
}

const PROFILE_FIELDS = {
  id: true, name: true, contactEmail: true, contactPhone: true, ncpdpId: true, statesServed: true,
} as const;

/** Everything about the connection except the one thing that must never leave. */
function publicConfig(config: {
  baseUrl: string;
  vendorId: string | null;
  locationId: string | null;
  apiNetworkId: string | null;
  practiceId: string | null;
  defaultShippingService: string | null;
  timeoutMs: number;
  isEnabled: boolean;
  credentialCipher: string | null;
}) {
  return {
    baseUrl: config.baseUrl,
    vendorId: config.vendorId,
    locationId: config.locationId,
    apiNetworkId: config.apiNetworkId,
    practiceId: config.practiceId,
    defaultShippingService: config.defaultShippingService,
    timeoutMs: config.timeoutMs,
    isEnabled: config.isEnabled,
    hasStoredCredentials: Boolean(config.credentialCipher),
  };
}
