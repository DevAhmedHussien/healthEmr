import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  RosterInput,
  UpdateProviderInput,
  UpdateTenantInput,
} from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

/**
 * Everything the platform owner can change.
 *
 * Two rules hold throughout, and both are deliberate:
 *
 * 1. **Nothing clinical or financial is ever destroyed.** Removing a pharmacy
 *    that filled prescriptions, or a clinician who signed them, would orphan
 *    records the law requires us to keep for years and would make the audit
 *    trail refer to rows that no longer exist. Those are *archived*: excluded
 *    from routing and from the working directory, fully retained, reversible.
 *    True deletion is reserved for rows nothing references — an unused catalog
 *    product, an empty category — and lives with the catalogue it belongs to,
 *    in PharmacyCatalogService.
 *
 * 2. **Every change records a before and an after.** Not "the pharmacy was
 *    updated", but which field moved, from what, to what, by whom. A trail that
 *    cannot answer "what changed?" only tells you where to start guessing.
 */
@Injectable()
export class GovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── client businesses ────────────────────────────────────────────────────

  async updateTenant(id: string, input: UpdateTenantInput, actorUserId: string) {
    const { reason, ...changes } = input;
    const before = await this.prisma.raw.tenant.findUnique({
      where: { id },
      select: TENANT_AUDIT_FIELDS,
    });
    if (!before) throw new NotFoundException('That client account does not exist');

    if (changes.contactEmail && changes.contactEmail !== before.contactEmail) {
      // The contact address is how invitations and billing reach them, so a
      // collision is a real problem rather than a cosmetic one.
      const clash = await this.prisma.raw.tenant.findFirst({
        where: { contactEmail: changes.contactEmail, id: { not: id } },
        select: { name: true },
      });
      if (clash) throw new ConflictException(`${clash.name} already uses that contact address`);
    }

    const after = await this.prisma.raw.tenant.update({
      where: { id },
      data: changes,
      select: TENANT_AUDIT_FIELDS,
    });

    await this.audit.record({
      action: 'TENANT_UPDATED',
      entityType: 'Tenant',
      entityId: id,
      tenantId: id,
      actorUserId,
      before,
      after: { ...after, reason: reason ?? null },
    });

    return after;
  }

  async archiveTenant(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.tenant.findUnique({
      where: { id },
      select: { ...TENANT_AUDIT_FIELDS, status: true, archivedAt: true },
    });
    if (!before) throw new NotFoundException('That client account does not exist');
    if (before.archivedAt) throw new ConflictException('That account is already archived');

    const after = await this.prisma.raw.$transaction(async (tx) => {
      // Their people lose access immediately. The records they created stay.
      await tx.user.updateMany({ where: { tenantId: id }, data: { isActive: false } });
      await tx.tenantApiKey.updateMany({ where: { tenantId: id }, data: { revokedAt: new Date() } });
      return tx.tenant.update({
        where: { id },
        data: {
          status: 'CLOSED',
          archivedAt: new Date(),
          archivedReason: reason,
          archivedByUserId: actorUserId,
        },
        select: { ...TENANT_AUDIT_FIELDS, status: true, archivedAt: true },
      });
    });

    await this.audit.record({
      action: 'ACCOUNT_SUSPENDED',
      entityType: 'Tenant',
      entityId: id,
      tenantId: id,
      actorUserId,
      before,
      after: { ...after, reason },
    });

    return after;
  }

  async restoreTenant(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.tenant.findUnique({
      where: { id },
      select: { ...TENANT_AUDIT_FIELDS, status: true, archivedAt: true },
    });
    if (!before) throw new NotFoundException('That client account does not exist');
    if (!before.archivedAt) throw new ConflictException('That account is not archived');

    // Their API keys are not revived. A key that was revoked while the account
    // was closed should be reissued deliberately, not silently reactivated.
    const after = await this.prisma.raw.tenant.update({
      where: { id },
      data: { status: 'ACTIVE', archivedAt: null, archivedReason: null, archivedByUserId: null },
      select: { ...TENANT_AUDIT_FIELDS, status: true, archivedAt: true },
    });

    await this.audit.record({
      action: 'ACCOUNT_REACTIVATED',
      entityType: 'Tenant',
      entityId: id,
      tenantId: id,
      actorUserId,
      before,
      after: { ...after, reason },
    });

    return after;
  }

  // ── roster: which pharmacies and clinicians serve a client ───────────────

  async attachToTenant(tenantId: string, input: RosterInput, actorUserId: string) {
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!tenant) throw new NotFoundException('That client account does not exist');

    if (input.pharmacyId) {
      const pharmacy = await this.prisma.raw.pharmacy.findUnique({
        where: { id: input.pharmacyId },
        select: { id: true, name: true, status: true },
      });
      if (!pharmacy) throw new NotFoundException('That pharmacy does not exist');
      if (pharmacy.status === 'ARCHIVED') {
        throw new BadRequestException('That pharmacy is archived. Restore it before adding it to a client.');
      }

      await this.prisma.raw.tenantPharmacy.upsert({
        where: { tenantId_pharmacyId: { tenantId, pharmacyId: input.pharmacyId } },
        create: { tenantId, pharmacyId: input.pharmacyId },
        update: {},
      });

      await this.audit.record({
        action: 'ENTITLEMENT_CHANGED',
        entityType: 'TenantPharmacy',
        entityId: `${tenantId}:${input.pharmacyId}`,
        tenantId,
        actorUserId,
        after: { name: `${pharmacy.name} → ${tenant.name}`, attached: true, reason: input.reason ?? null },
      });
    }

    if (input.providerId) {
      const provider = await this.prisma.raw.providerProfile.findUnique({
        where: { id: input.providerId },
        select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
      });
      if (!provider) throw new NotFoundException('That provider does not exist');
      if (provider.status === 'ARCHIVED') {
        throw new BadRequestException('That provider is archived. Restore them before adding them to a client.');
      }

      await this.prisma.raw.tenantProvider.upsert({
        where: { tenantId_providerId: { tenantId, providerId: input.providerId } },
        create: { tenantId, providerId: input.providerId },
        update: { endedAt: null },
      });

      await this.audit.record({
        action: 'ENTITLEMENT_CHANGED',
        entityType: 'TenantProvider',
        entityId: `${tenantId}:${input.providerId}`,
        tenantId,
        actorUserId,
        after: {
          name: `${provider.user.firstName} ${provider.user.lastName} → ${tenant.name}`,
          attached: true,
          reason: input.reason ?? null,
        },
      });
    }

    return { ok: true };
  }

  async detachFromTenant(tenantId: string, input: RosterInput, actorUserId: string) {
    if (input.pharmacyId) {
      // Detaching is a real delete because the link carries no history of its
      // own — what it enabled is recorded on the orders themselves, which stay.
      const removed = await this.prisma.raw.tenantPharmacy.deleteMany({
        where: { tenantId, pharmacyId: input.pharmacyId },
      });
      if (!removed.count) throw new NotFoundException('That pharmacy is not on this client’s roster');

      await this.audit.record({
        action: 'ENTITLEMENT_CHANGED',
        entityType: 'TenantPharmacy',
        entityId: `${tenantId}:${input.pharmacyId}`,
        tenantId,
        actorUserId,
        before: { attached: true },
        after: { attached: false, reason: input.reason ?? null },
      });
    }

    if (input.providerId) {
      // A clinician's link is ended rather than deleted: prescriptions they
      // signed for this client must remain explicable years later.
      const link = await this.prisma.raw.tenantProvider.findUnique({
        where: { tenantId_providerId: { tenantId, providerId: input.providerId } },
        select: { id: true, endedAt: true },
      });
      if (!link) throw new NotFoundException('That provider is not on this client’s roster');

      await this.prisma.raw.tenantProvider.update({
        where: { id: link.id },
        data: { endedAt: new Date() },
      });

      await this.audit.record({
        action: 'PROVIDER_REASSIGNED',
        entityType: 'TenantProvider',
        entityId: `${tenantId}:${input.providerId}`,
        tenantId,
        actorUserId,
        before: { contracted: true },
        after: { contracted: false, reason: input.reason ?? null },
      });
    }

    return { ok: true };
  }

  // ── clinicians ───────────────────────────────────────────────────────────

  async updateProvider(id: string, input: UpdateProviderInput, actorUserId: string) {
    const { reason, firstName, lastName, ...profile } = input;

    const before = await this.prisma.raw.providerProfile.findUnique({
      where: { id },
      select: PROVIDER_AUDIT_FIELDS,
    });
    if (!before) throw new NotFoundException('That provider does not exist');

    if (profile.npi && profile.npi !== before.npi) {
      const clash = await this.prisma.raw.providerProfile.findFirst({
        where: { npi: profile.npi, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('Another provider already has that NPI');
    }

    const after = await this.prisma.raw.$transaction(async (tx) => {
      if (firstName || lastName) {
        await tx.user.update({
          where: { id: before.userId },
          data: { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) },
        });
      }
      return Object.keys(profile).length
        ? tx.providerProfile.update({ where: { id }, data: profile, select: PROVIDER_AUDIT_FIELDS })
        : tx.providerProfile.findUniqueOrThrow({ where: { id }, select: PROVIDER_AUDIT_FIELDS });
    });

    await this.audit.record({
      action: 'USER_UPDATED',
      entityType: 'ProviderProfile',
      entityId: id,
      actorUserId,
      before,
      after: { ...after, reason: reason ?? null },
    });

    return after;
  }

  async archiveProvider(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.providerProfile.findUnique({
      where: { id },
      select: { ...PROVIDER_AUDIT_FIELDS, status: true, archivedAt: true },
    });
    if (!before) throw new NotFoundException('That provider does not exist');
    if (before.archivedAt) throw new ConflictException('That provider is already archived');

    // Work in flight is the reason this is a refusal rather than a warning: a
    // visit assigned to somebody who can no longer sign it stalls silently until
    // a patient complains.
    // Counted from the lines they owe a decision on, not the visits that name
    // them: on a visit shared with a colleague only one clinician is named, and
    // archiving the other would strand exactly the lines this check exists for.
    const openWork = await this.prisma.raw.prescriptionRequest.count({
      where: {
        voidedAt: null,
        status: { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] },
        items: { some: { assignedProviderId: id, decision: 'PENDING' } },
      },
    });
    if (openWork) {
      throw new ConflictException(
        `That provider still has ${openWork} visit${openWork === 1 ? '' : 's'} open. ` +
          'Reassign them first — archiving now would leave those patients waiting on somebody who cannot act.',
      );
    }

    const after = await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
      await tx.tenantProvider.updateMany({ where: { providerId: id, endedAt: null }, data: { endedAt: new Date() } });
      return tx.providerProfile.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          isAcceptingRequests: false,
          archivedAt: new Date(),
          archivedReason: reason,
          archivedByUserId: actorUserId,
        },
        select: { ...PROVIDER_AUDIT_FIELDS, status: true, archivedAt: true },
      });
    });

    await this.audit.record({
      action: 'USER_DEACTIVATED',
      entityType: 'ProviderProfile',
      entityId: id,
      actorUserId,
      before,
      after: { ...after, reason },
    });

    return after;
  }

  async restoreProvider(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.providerProfile.findUnique({
      where: { id },
      select: { ...PROVIDER_AUDIT_FIELDS, status: true, archivedAt: true },
    });
    if (!before) throw new NotFoundException('That provider does not exist');
    if (!before.archivedAt) throw new ConflictException('That provider is not archived');

    const after = await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.update({ where: { id: before.userId }, data: { isActive: true } });
      return tx.providerProfile.update({
        where: { id },
        data: { status: 'ACTIVE', archivedAt: null, archivedReason: null, archivedByUserId: null },
        select: { ...PROVIDER_AUDIT_FIELDS, status: true, archivedAt: true },
      });
    });

    await this.audit.record({
      action: 'ACCOUNT_REACTIVATED',
      entityType: 'ProviderProfile',
      entityId: id,
      actorUserId,
      before,
      after: { ...after, reason },
    });

    return after;
  }

  // ── pharmacies ───────────────────────────────────────────────────────────

  async archivePharmacy(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.pharmacy.findUnique({
      where: { id },
      select: { ...PHARMACY_AUDIT_FIELDS, status: true, archivedAt: true },
    });
    if (!before) throw new NotFoundException('That pharmacy does not exist');
    if (before.archivedAt) throw new ConflictException('That pharmacy is already archived');

    const openOrders = await this.prisma.raw.pharmacyOrder.count({
      where: { pharmacyId: id, status: { in: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'] } },
    });
    if (openOrders) {
      throw new ConflictException(
        `That pharmacy has ${openOrders} order${openOrders === 1 ? '' : 's'} still in flight. ` +
          'Move or cancel them first — a patient is waiting on each one.',
      );
    }

    const after = await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { pharmacyId: id }, data: { isActive: false } });
      await tx.tenantPharmacy.deleteMany({ where: { pharmacyId: id } });
      return tx.pharmacy.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          isActive: false,
          archivedAt: new Date(),
          archivedReason: reason,
          archivedByUserId: actorUserId,
        },
        select: { ...PHARMACY_AUDIT_FIELDS, status: true, archivedAt: true },
      });
    });

    await this.audit.record({
      action: 'ACCOUNT_SUSPENDED',
      entityType: 'Pharmacy',
      entityId: id,
      actorUserId,
      before,
      after: { ...after, reason },
    });

    return after;
  }

  async restorePharmacy(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.pharmacy.findUnique({
      where: { id },
      select: { ...PHARMACY_AUDIT_FIELDS, status: true, archivedAt: true },
    });
    if (!before) throw new NotFoundException('That pharmacy does not exist');
    if (!before.archivedAt) throw new ConflictException('That pharmacy is not archived');

    const after = await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { pharmacyId: id }, data: { isActive: true } });
      return tx.pharmacy.update({
        where: { id },
        data: { status: 'ACTIVE', isActive: true, archivedAt: null, archivedReason: null, archivedByUserId: null },
        select: { ...PHARMACY_AUDIT_FIELDS, status: true, archivedAt: true },
      });
    });

    await this.audit.record({
      action: 'ACCOUNT_REACTIVATED',
      entityType: 'Pharmacy',
      entityId: id,
      actorUserId,
      before,
      after: { ...after, reason },
    });

    return after;
  }

}

/**
 * What each audit snapshot captures.
 *
 * Narrow on purpose: the log is retained for years and read by people who do not
 * need clinical detail to answer "who changed this". Snapshotting whole rows
 * would quietly turn the audit table into a second copy of the database.
 */
const TENANT_AUDIT_FIELDS = {
  id: true, name: true, slug: true, contactEmail: true, contactPhone: true,
  ownerName: true, billingPlan: true, allowedStates: true,
} satisfies Prisma.TenantSelect;

const PROVIDER_AUDIT_FIELDS = {
  id: true, userId: true, npi: true, credentials: true, specialties: true,
  isAcceptingRequests: true, maxOpenRequests: true, bio: true,
} satisfies Prisma.ProviderProfileSelect;

const PHARMACY_AUDIT_FIELDS = {
  id: true, name: true, slug: true, contactEmail: true, contactPhone: true, ncpdpId: true,
  statesServed: true, dispensesCompounded: true, dispensesBranded: true, isActive: true,
} satisfies Prisma.PharmacySelect;


