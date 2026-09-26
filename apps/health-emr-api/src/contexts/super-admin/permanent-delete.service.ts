import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

/**
 * Erasing a record for good.
 *
 * Archiving is the normal answer and this is not a stronger version of it —
 * it is a different thing for a different case. Archiving takes an account out
 * of use and keeps everything; this removes the row, and what the row was is
 * then only recoverable from the audit trail.
 *
 * So it is refused the moment anything clinical refers to the account. That is
 * not caution, it is the law and the schema agreeing for once: health records
 * carry a retention period measured in years, and deleting the business a visit
 * belonged to would either cascade into that visit or leave it pointing at
 * nothing. Neither is acceptable, and "which one happens" should not depend on
 * a foreign key's delete rule.
 *
 * What it is genuinely for: the account created by mistake, the duplicate, the
 * test pharmacy somebody added while evaluating. Those have no clinical history
 * and no reason to sit in the archive forever.
 */
@Injectable()
export class PermanentDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * What would be destroyed, without destroying it.
   *
   * Asked by the console before it offers the button, so an administrator is
   * told "this cannot be deleted, it has 31 visits" rather than discovering it
   * by pressing the thing and reading an error.
   */
  async inspect(kind: Kind, id: string) {
    const blockers = await this.blockers(kind, id);
    return {
      kind,
      id,
      deletable: blockers.length === 0,
      blockers,
      alternative:
        blockers.length > 0
          ? 'Archive it instead — it stops being used and everything is kept.'
          : null,
    };
  }

  async remove(kind: Kind, id: string, reason: string, actorUserId: string) {
    const blockers = await this.blockers(kind, id);
    if (blockers.length) {
      throw new ConflictException(
        `This cannot be deleted while ${blockers
          .map((blocker) => `${blocker.count} ${blocker.what}`)
          .join(', ')} refer to it. Archive it instead.`,
      );
    }

    const before = await this.snapshot(kind, id);

    // Recorded before the row goes, so the trail does not depend on the delete
    // succeeding to explain what was attempted.
    await this.audit.record({
      action: 'PHI_DELETED',
      entityType: ENTITY[kind],
      entityId: id,
      actorUserId,
      before,
      after: { deleted: true, reason },
    });

    switch (kind) {
      case 'tenant':
        await this.prisma.raw.tenant.delete({ where: { id } });
        break;
      case 'provider':
        await this.prisma.raw.providerProfile.delete({ where: { id } });
        break;
      case 'pharmacy':
        await this.prisma.raw.pharmacy.delete({ where: { id } });
        break;
    }

    return { removed: true, kind, id };
  }

  /**
   * Everything that would be orphaned or cascaded into.
   *
   * Counted rather than merely detected, because the number is what makes the
   * refusal persuasive: "31 visits" tells an administrator this is a real
   * account and they have the wrong one.
   */
  private async blockers(kind: Kind, id: string): Promise<Blocker[]> {
    const found: Blocker[] = [];
    const add = (count: number, what: string) => {
      if (count > 0) found.push({ count, what });
    };

    if (kind === 'tenant') {
      const tenant = await this.prisma.raw.tenant.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!tenant) throw new NotFoundException('That client account does not exist');

      const [
        visits,
        prescriptions,
        patients,
        encounters,
        submissions,
        threads,
        orders,
        invoices,
        earnings,
        users,
      ] = await Promise.all([
        this.prisma.raw.prescriptionRequest.count({ where: { tenantId: id } }),
        this.prisma.raw.prescription.count({ where: { tenantId: id } }),
        this.prisma.raw.tenantPatient.count({ where: { tenantId: id } }),
        this.prisma.raw.encounter.count({ where: { tenantId: id } }),
        this.prisma.raw.qaSubmission.count({ where: { tenantId: id } }),
        this.prisma.raw.chatThread.count({ where: { tenantId: id } }),
        this.prisma.raw.pharmacyOrder.count({ where: { tenantId: id } }),
        this.prisma.raw.invoice.count({ where: { tenantId: id } }),
        this.prisma.raw.providerEarning.count({ where: { tenantId: id } }),
        this.prisma.raw.user.count({ where: { tenantId: id } }),
      ]);
      add(visits, visits === 1 ? 'visit' : 'visits');
      add(prescriptions, prescriptions === 1 ? 'prescription' : 'prescriptions');
      add(patients, patients === 1 ? 'patient' : 'patients');
      add(encounters, encounters === 1 ? 'clinical encounter' : 'clinical encounters');
      add(submissions, submissions === 1 ? 'intake questionnaire' : 'intake questionnaires');
      add(threads, threads === 1 ? 'conversation' : 'conversations');
      add(orders, orders === 1 ? 'pharmacy order' : 'pharmacy orders');
      add(invoices, invoices === 1 ? 'invoice' : 'invoices');
      add(earnings, earnings === 1 ? 'clinician payment' : 'clinician payments');
      add(users, users === 1 ? 'staff account' : 'staff accounts');
      return found;
    }

    if (kind === 'provider') {
      const provider = await this.prisma.raw.providerProfile.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!provider) throw new NotFoundException('That clinician does not exist');

      const [visits, prescriptions, lines] = await Promise.all([
        this.prisma.raw.prescriptionRequest.count({ where: { assignedProviderId: id } }),
        this.prisma.raw.prescription.count({ where: { providerId: id } }),
        this.prisma.raw.prescriptionRequestItem.count({ where: { assignedProviderId: id } }),
      ]);
      add(visits, visits === 1 ? 'visit' : 'visits');
      add(prescriptions, prescriptions === 1 ? 'prescription' : 'prescriptions');
      add(lines, lines === 1 ? 'decided line' : 'decided lines');
      return found;
    }

    const pharmacy = await this.prisma.raw.pharmacy.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!pharmacy) throw new NotFoundException('That pharmacy does not exist');

    const [orders, requests, staff] = await Promise.all([
      this.prisma.raw.pharmacyOrder.count({ where: { pharmacyId: id } }),
      this.prisma.raw.prescriptionRequest.count({ where: { requestedPharmacyId: id } }),
      this.prisma.raw.user.count({ where: { pharmacyId: id } }),
    ]);
    add(orders, orders === 1 ? 'order' : 'orders');
    add(requests, requests === 1 ? 'visit' : 'visits');
    add(staff, staff === 1 ? 'staff account' : 'staff accounts');
    return found;
  }

  /** Enough of the record to say afterwards what was removed. */
  private async snapshot(kind: Kind, id: string) {
    if (kind === 'tenant') {
      return this.prisma.raw.tenant.findUnique({
        where: { id },
        select: { id: true, slug: true, name: true, createdAt: true },
      });
    }
    if (kind === 'provider') {
      return this.prisma.raw.providerProfile.findUnique({
        where: { id },
        select: {
          id: true,
          npi: true,
          createdAt: true,
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      });
    }
    return this.prisma.raw.pharmacy.findUnique({
      where: { id },
      select: { id: true, slug: true, name: true, createdAt: true },
    });
  }
}

export type Kind = 'tenant' | 'provider' | 'pharmacy';

/**
 * Models that must be counted before a tenant is erased.
 *
 * Deleting a tenant cascades into fifteen tables. Counting four of them and
 * calling the rest safe is how a client account with encounters but no visits
 * reported itself deletable and took the encounters with it — the delete rule
 * lived in the schema and the refusal lived here, and only one of them knew
 * the whole list.
 *
 * `permanent-delete.service.spec.ts` reads the Prisma DMMF and fails the build
 * when a model carrying a tenant key appears in neither this list nor the one
 * below, so the next table to gain a `tenantId` cannot be forgotten.
 */
export const TENANT_DELETE_BLOCKERS = [
  'PrescriptionRequest',
  'Prescription',
  'TenantPatient',
  'Encounter',
  'QaSubmission',
  'ChatThread',
  'PharmacyOrder',
  'Invoice',
  'ProviderEarning',
  'User',
] as const;

/**
 * Models that may go when the tenant goes, with the reason each is safe.
 *
 * Every one of these is the tenant's own configuration — what it sells, who
 * fills for it, which keys its server holds. None of it means anything without
 * the account it configures, and none of it is a record of care.
 */
export const TENANT_DELETE_CASCADE_OK: Readonly<Record<string, string>> = {
  TenantApiKey: 'Credentials for an account that is going. Useless once it has gone, and a live key for a deleted tenant is worse than none.',
  TenantWebhook: 'Where this client asked for its events. There will be no further events.',
  TenantCategory: 'Which categories this client was entitled to sell. An entitlement, not a record of care.',
  TenantMedication: 'This client\'s slice of the catalogue and its prices. The catalogue itself is platform-owned and untouched.',
  TenantPharmacy: 'Which pharmacies this client routed to. The pharmacies themselves are untouched.',
  TenantProvider: 'Which clinicians served this client. The clinicians and their licences are untouched.',
  AuditLog:
    'Never deleted. The foreign key is SET NULL and the row survives with actorEmail, tenantSlug and actorRole frozen as text — attribution has to outlive the account it refers to.',
  Notification:
    'A delivery record addressed to a person, not to the tenant. The tenantId here is provenance and carries no foreign key, so nothing cascades.',
  Pharmacy:
    'Only primaryTenantId points here, and it is SET NULL. A pharmacy outlives any one client it happened to be introduced by.',
  ProviderProfile:
    'Only primaryTenantId points here, and it is SET NULL. A clinician outlives any one client they happened to work for.',
};

export interface Blocker {
  count: number;
  what: string;
}

const ENTITY: Record<Kind, string> = {
  tenant: 'Tenant',
  provider: 'ProviderProfile',
  pharmacy: 'Pharmacy',
};
