import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@health-emr/types';
import { PlatformPermission, Role, hasPermission } from '@health-emr/types';
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
  private readonly logger = new Logger(PermanentDeleteService.name);

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
  async inspect(kind: Kind, id: string, actor?: AuthenticatedUser): Promise<DeletionReport> {
    const { hard, staff } = await this.blockers(kind, id);
    const staffAccounts = kind === 'tenant' ? await this.staffOf(id) : [];
    const mayResolve = Boolean(actor && this.mayRemoveStaff(actor));

    return {
      kind,
      id,
      confirmPhrase: await this.confirmPhrase(kind, id),
      deletable: hard.length === 0 && staff.length === 0,
      // Deletable by this caller once they agree to take the staff accounts
      // with it. False when anything clinical is in the way, whoever is asking:
      // that refusal is not a permission this platform hands out.
      deletableByOwner: hard.length === 0 && staff.length > 0 && mayResolve,
      hardBlockers: hard,
      staffBlockers: staff,
      /** Both, in one list, for anything that only wants to say what is in the way. */
      blockers: [...hard, ...staff],
      staffAccounts,
      alternative: hard.length > 0 || staff.length > 0 ? ARCHIVE_INSTEAD : null,
    };
  }

  /**
   * Erase the record, and — when asked for and permitted — the staff accounts
   * that are the only thing left referring to it.
   *
   * `removeStaffAccounts` is consent, not authority. The caller has already
   * passed ACCOUNTS_DELETE to reach this method; what the flag adds is that
   * they were shown which logins would go and said yes. It is re-read here
   * rather than trusted from the console, because "the UI would not have sent
   * it" is not a check.
   */
  async remove(
    kind: Kind,
    id: string,
    reason: string,
    actor: AuthenticatedUser,
    removeStaffAccounts = false,
  ) {
    const { hard, staff } = await this.blockers(kind, id);
    this.refuseIfBlocked(hard, staff, removeStaffAccounts && this.mayRemoveStaff(actor));

    const doomed =
      removeStaffAccounts && kind === 'tenant' ? await this.deletableStaffOf(id, actor) : [];
    const before = await this.snapshot(kind, id);

    // Recorded before the transaction, and deliberately outside it. The audit
    // trail is hash-chained on a monotonic sequence, so a rolled-back entry
    // would leave a gap — and a gap is read as tampering, which is a worse
    // thing to leave behind than a record of an attempt. The compensating
    // entry below is how a failure gets told truthfully.
    await this.audit.record({
      action: 'PHI_DELETED',
      entityType: ENTITY[kind],
      entityId: id,
      actorUserId: actor.id,
      before,
      after: {
        deleted: true,
        reason,
        staffAccountsRemoved: doomed.map((user) => ({
          id: user.id,
          email: user.email,
          role: user.role,
          wasActive: user.isActive,
        })),
      },
    });

    try {
      await this.prisma.raw.$transaction(async (tx) => {
        // Counted again, inside the transaction and against its snapshot. The
        // gap between the check above and this one is small and real: a visit
        // posted by the tenant's own server in that window would otherwise be
        // erased by a decision taken before it existed.
        const recount = await this.blockers(kind, id, tx);
        this.refuseIfBlocked(
          recount.hard,
          recount.staff,
          removeStaffAccounts && this.mayRemoveStaff(actor),
        );

        if (doomed.length) {
          await tx.user.deleteMany({ where: { id: { in: doomed.map((user) => user.id) } } });
        }

        switch (kind) {
          case 'tenant':
            await tx.tenant.delete({ where: { id } });
            break;
          case 'provider':
            await tx.providerProfile.delete({ where: { id } });
            break;
          case 'pharmacy':
            await tx.pharmacy.delete({ where: { id } });
            break;
        }
      });
    } catch (cause) {
      // The entry above says this was deleted. It was not, and the trail has
      // to say so rather than be corrected by removing what it already wrote.
      await this.audit.record({
        action: 'PHI_DELETED',
        entityType: ENTITY[kind],
        entityId: id,
        actorUserId: actor.id,
        before,
        after: {
          deleted: false,
          rolledBack: true,
          reason,
          failure: cause instanceof Error ? cause.message : 'unknown',
        },
      });
      this.logger.error(`Rolled back the deletion of ${kind} ${id}`, cause as Error);
      throw cause;
    }

    return {
      removed: true,
      kind,
      id,
      staffAccountsRemoved: doomed.map((user) => user.email),
    };
  }

  /** The refusal, in one place, so the check and the recount cannot disagree. */
  private refuseIfBlocked(hard: Blocker[], staff: Blocker[], staffMayGo: boolean): void {
    const standing = staffMayGo ? hard : [...hard, ...staff];
    if (!standing.length) return;

    const listed = standing
      .map((blocker) => `${blocker.count} ${blocker.what}`)
      .join(', ');
    // Singular where there is one of it: "1 staff account refers to it" rather
    // than the count agreeing with the noun and not the verb.
    const verb = standing.length === 1 && standing[0].count === 1 ? 'refers' : 'refer';

    throw new ConflictException(`This cannot be deleted while ${listed} ${verb} to it. ${ARCHIVE_INSTEAD}`);
  }

  /** OWNER always; a super admin only with the grant an owner handed them. */
  private mayRemoveStaff(actor: AuthenticatedUser): boolean {
    return hasPermission(actor, PlatformPermission.ACCOUNTS_DELETE);
  }

  /**
   * The staff accounts this caller may actually take with the tenant.
   *
   * Every one is re-read and re-checked here rather than taken from whatever
   * the console listed. Four accounts are never included, whoever is asking:
   * an owner, the caller themselves, a super admin unless an owner is asking,
   * and anybody whose clinical work would be rewritten by their removal.
   */
  private async deletableStaffOf(tenantId: string, actor: AuthenticatedUser) {
    const staff = await this.staffOf(tenantId);
    const refused: string[] = [];
    const allowed: StaffAccount[] = [];

    for (const user of staff) {
      const why = await this.whyStaffCannotGo(user, actor);
      if (why) refused.push(`${user.email} — ${why}`);
      else allowed.push(user);
    }

    if (refused.length) {
      throw new ConflictException(
        `These staff accounts cannot be deleted: ${refused.join('; ')}. ${ARCHIVE_INSTEAD}`,
      );
    }
    return allowed;
  }

  /**
   * Why a staff account has to stay, or null if it may go.
   *
   * The clinical half is the point: a note, a message, a chart or a clinician
   * profile is a record of who did something to a patient, and a medical record
   * that cannot say who wrote it is a worse artefact than one belonging to a
   * closed account. Queried by user id with no tenant filter, so work done for
   * another client counts exactly as much.
   */
  private async whyStaffCannotGo(
    user: StaffAccount,
    actor: AuthenticatedUser,
  ): Promise<string | null> {
    if (user.role === Role.OWNER) return 'an owner is never deleted from here';
    if (user.id === actor.id) return 'you cannot delete your own account';
    if (user.role === Role.SUPER_ADMIN && actor.role !== Role.OWNER) {
      return 'only an owner can delete a super admin';
    }

    const [notes, messages, participations, profile, patient] = await Promise.all([
      this.prisma.raw.providerNote.count({ where: { authorUserId: user.id } }),
      this.prisma.raw.chatMessage.count({ where: { authorUserId: user.id } }),
      this.prisma.raw.chatParticipant.count({ where: { userId: user.id } }),
      this.prisma.raw.providerProfile.count({ where: { userId: user.id } }),
      this.prisma.raw.patient.count({ where: { userId: user.id } }),
    ]);

    if (profile) return 'this is a clinician account, not client staff';
    if (patient) return 'this account is also a patient record';
    if (notes) return `${notes} clinical note${notes === 1 ? '' : 's'} were written by it`;
    if (messages) return `${messages} message${messages === 1 ? '' : 's'} were sent by it`;
    if (participations) return 'it took part in a patient conversation';

    return null;
  }

  /** Staff of this tenant, and only this tenant. */
  private async staffOf(tenantId: string): Promise<StaffAccount[]> {
    return this.prisma.raw.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, role: true, isActive: true, archivedAt: true },
      orderBy: { email: 'asc' },
    });
  }

  /** What has to be typed to confirm. A slug is exact; a display name is not. */
  private async confirmPhrase(kind: Kind, id: string): Promise<string | null> {
    if (kind === 'tenant') {
      const tenant = await this.prisma.raw.tenant.findUnique({
        where: { id },
        select: { slug: true },
      });
      return tenant?.slug ?? null;
    }
    if (kind === 'pharmacy') {
      const pharmacy = await this.prisma.raw.pharmacy.findUnique({
        where: { id },
        select: { slug: true },
      });
      return pharmacy?.slug ?? null;
    }
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id },
      select: { npi: true },
    });
    return provider?.npi ?? null;
  }

  /**
   * Everything that would be orphaned or cascaded into.
   *
   * Counted rather than merely detected, because the number is what makes the
   * refusal persuasive: "31 visits" tells an administrator this is a real
   * account and they have the wrong one.
   */
  private async blockers(
    kind: Kind,
    id: string,
    /** The transaction's client, when recounting inside one. */
    client: DbClient = this.prisma.raw,
  ): Promise<{ hard: Blocker[]; staff: Blocker[] }> {
    const found: Blocker[] = [];
    const staff: Blocker[] = [];
    const add = (count: number, what: string) => {
      if (count > 0) found.push({ count, what });
    };

    if (kind === 'tenant') {
      const tenant = await client.tenant.findUnique({
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
        client.prescriptionRequest.count({ where: { tenantId: id } }),
        client.prescription.count({ where: { tenantId: id } }),
        client.tenantPatient.count({ where: { tenantId: id } }),
        client.encounter.count({ where: { tenantId: id } }),
        client.qaSubmission.count({ where: { tenantId: id } }),
        client.chatThread.count({ where: { tenantId: id } }),
        client.pharmacyOrder.count({ where: { tenantId: id } }),
        client.invoice.count({ where: { tenantId: id } }),
        client.providerEarning.count({ where: { tenantId: id } }),
        client.user.count({ where: { tenantId: id } }),
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

      // Apart from the rest on purpose. Everything above is a record of care
      // or of money and stops the deletion for everybody; a staff account is
      // an administrative row that can go with the account it belongs to, if
      // whoever is asking is allowed to take it and nothing clinical of theirs
      // would go too.
      if (users > 0) {
        staff.push({ count: users, what: users === 1 ? 'staff account' : 'staff accounts' });
      }
      return { hard: found, staff };
    }

    if (kind === 'provider') {
      const provider = await client.providerProfile.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!provider) throw new NotFoundException('That clinician does not exist');

      const [visits, prescriptions, lines] = await Promise.all([
        client.prescriptionRequest.count({ where: { assignedProviderId: id } }),
        client.prescription.count({ where: { providerId: id } }),
        client.prescriptionRequestItem.count({ where: { assignedProviderId: id } }),
      ]);
      add(visits, visits === 1 ? 'visit' : 'visits');
      add(prescriptions, prescriptions === 1 ? 'prescription' : 'prescriptions');
      add(lines, lines === 1 ? 'decided line' : 'decided lines');
      return { hard: found, staff };
    }

    const pharmacy = await this.prisma.raw.pharmacy.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!pharmacy) throw new NotFoundException('That pharmacy does not exist');

    const [orders, requests, pharmacyStaff] = await Promise.all([
      client.pharmacyOrder.count({ where: { pharmacyId: id } }),
      client.prescriptionRequest.count({ where: { requestedPharmacyId: id } }),
      client.user.count({ where: { pharmacyId: id } }),
    ]);
    add(orders, orders === 1 ? 'order' : 'orders');
    add(requests, requests === 1 ? 'visit' : 'visits');
    add(pharmacyStaff, pharmacyStaff === 1 ? 'staff account' : 'staff accounts');
    return { hard: found, staff };
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

/** A tenant's staff account, as the console needs to show it before agreeing. */
export interface StaffAccount {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  archivedAt: Date | null;
}

export interface DeletionReport {
  kind: Kind;
  id: string;
  /** What has to be typed to confirm — a slug, never a display name. */
  confirmPhrase: string | null;
  /** Nothing refers to this at all. */
  deletable: boolean;
  /**
   * Only staff accounts are in the way, and this caller holds the grant that
   * lets them go. False whenever anything clinical is in the way, for everyone.
   */
  deletableByOwner: boolean;
  /** Records of care or of money. These stop the deletion for everybody. */
  hardBlockers: Blocker[];
  /** Administrative rows that can go with the account they belong to. */
  staffBlockers: Blocker[];
  /** Both together, for anything that only needs to say what is in the way. */
  blockers: Blocker[];
  staffAccounts: StaffAccount[];
  alternative: string | null;
}

/**
 * Either the caller's own Prisma client or a transaction's.
 *
 * The recount has to run inside the transaction to mean anything, and the
 * same code has to serve both calls or the two counts could differ for
 * reasons that have nothing to do with the data.
 */
type DbClient = Prisma.TransactionClient | PrismaService['raw'];

const ARCHIVE_INSTEAD = 'Archive it instead — it stops being used and everything is kept.';

const ENTITY: Record<Kind, string> = {
  tenant: 'Tenant',
  provider: 'ProviderProfile',
  pharmacy: 'Pharmacy',
};
