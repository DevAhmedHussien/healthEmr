import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { InviteService } from '@/contexts/identity/invite.service';
import { ALL_PERMISSIONS, Role, type PlatformPermission } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

const FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  permissions: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/**
 * The owner's authority over the people who run the platform.
 *
 * Super admins can do a great deal, and until now the only way to create one
 * was to write a row by hand. That is the wrong amount of ceremony for an
 * account that can read every patient in the system — so it belongs in the
 * product, done by a named person, and recorded.
 *
 * The division is deliberate: an owner decides *who* administers and *what*
 * they may do; a super admin does the administering. An owner cannot be created
 * from in here, which keeps the number of people who can grant themselves
 * anything at exactly the number who were given the keys.
 */
@Injectable()
export class OwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Reused rather than reimplemented: invites are stored as a hash, revoke
    // any outstanding one, and carry a TTL. Three details to get wrong twice.
    private readonly invites: InviteService,
  ) {}

  /** Everyone who administers the platform, owners included. */
  async list() {
    const users = await this.prisma.raw.user.findMany({
      where: { role: { in: [Role.OWNER, Role.SUPER_ADMIN] } },
      select: FIELDS,
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    });

    return {
      data: users.map((user) => ({
        ...user,
        name: `${user.firstName} ${user.lastName}`.trim(),
        // An owner's list is shown as complete rather than as whatever happens
        // to be stored, because that is what the role actually confers.
        permissions: user.role === Role.OWNER ? [...ALL_PERMISSIONS] : user.permissions,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Add a super admin.
   *
   * Created with an unusable password and no way in until they set one, so the
   * account cannot be used by whoever created it. The invitation link is
   * returned once — email delivery is not yet wired, and returning it is
   * honest about that rather than leaving somebody waiting for a message that
   * will never arrive.
   */
  async create(
    input: {
      email: string;
      firstName: string;
      lastName: string;
      permissions: PlatformPermission[];
    },
    actorUserId: string,
  ) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.raw.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (existing) {
      throw new ConflictException('Somebody already uses that email address');
    }

    // Random and discarded, the same way every invited account is created here.
    // The invite is the only way in, so nobody — including whoever added them —
    // can sign in as this person.
    const unusable = await argon2.hash(randomBytes(32).toString('base64'), {
      type: argon2.argon2id,
    });

    const created = await this.prisma.raw.user.create({
      data: {
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        role: Role.SUPER_ADMIN,
        permissions: input.permissions,
        passwordHash: unusable,
        isActive: true,
      },
      select: FIELDS,
    });

    const token = await this.invites.issue(created.id, actorUserId);

    await this.audit.record({
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: created.id,
      actorUserId,
      after: { email, role: Role.SUPER_ADMIN, permissions: input.permissions },
    });

    return { ...created, name: `${created.firstName} ${created.lastName}`.trim(), inviteToken: token };
  }

  /**
   * Change what a super admin may do, or their name.
   *
   * An owner's own grants are not editable here — the list is notional for them
   * anyway, since the role carries everything.
   */
  async update(
    id: string,
    input: { firstName?: string; lastName?: string; permissions?: PlatformPermission[]; reason?: string },
    actorUserId: string,
  ) {
    const before = await this.mustBeManageable(id);

    const after = await this.prisma.raw.user.update({
      where: { id },
      data: {
        ...(input.firstName ? { firstName: input.firstName.trim() } : {}),
        ...(input.lastName ? { lastName: input.lastName.trim() } : {}),
        ...(input.permissions ? { permissions: input.permissions } : {}),
      },
      select: FIELDS,
    });

    await this.audit.record({
      action: 'USER_ROLE_CHANGED',
      entityType: 'User',
      entityId: id,
      actorUserId,
      before: { permissions: before.permissions },
      after: { permissions: after.permissions, ...(input.reason ? { reason: input.reason } : {}) },
    });

    return { ...after, name: `${after.firstName} ${after.lastName}`.trim() };
  }

  /** Suspend without deleting — the usual answer when somebody leaves. */
  async setActive(id: string, isActive: boolean, actorUserId: string, reason?: string) {
    await this.mustBeManageable(id);

    const user = await this.prisma.raw.user.update({
      where: { id },
      data: { isActive },
      select: FIELDS,
    });

    await this.audit.record({
      action: isActive ? 'ACCOUNT_REACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: id,
      actorUserId,
      after: { isActive, ...(reason ? { reason } : {}) },
    });

    return { ...user, name: `${user.firstName} ${user.lastName}`.trim() };
  }

  /**
   * Remove a super admin for good.
   *
   * Their audit entries survive, because attribution is copied into each one as
   * text when it is written — deleting the account cannot erase what the
   * account did, which is the entire point of recording it that way.
   */
  async remove(id: string, reason: string, actorUserId: string) {
    const user = await this.mustBeManageable(id);

    if (id === actorUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    // A super admin who broke the glass has written into patient records, and
    // the delete rules would have taken that with them: provider notes cascade
    // and chat messages are stripped of their author. Attribution on a medical
    // record is not ours to remove, so the account stays and is archived.
    const blocking = await this.clinicalReferences(id);
    if (blocking) {
      throw new ConflictException(
        `This account cannot be deleted because ${blocking}. Archive it instead — ` +
          'the login stops working and the record keeps who wrote it.',
      );
    }

    await this.prisma.raw.user.delete({ where: { id } });

    await this.audit.record({
      action: 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: id,
      actorUserId,
      before: { email: user.email, role: user.role, permissions: user.permissions },
      after: { deleted: true, reason },
    });

    return { removed: true, email: user.email };
  }

  /**
   * The checks that apply to every change.
   *
   * An owner is not editable from here by anybody, including another owner.
   * Ownership is conferred outside the product deliberately: an interface that
   * lets one owner strip another is an interface that lets a compromised
   * session take the platform.
   */
  /**
   * What this account wrote into the clinical record, in words, or null.
   *
   * Queried by user id and nothing else: work done for one client counts the
   * same as work done for another, and a platform administrator's work is not
   * scoped to any of them.
   */
  private async clinicalReferences(id: string): Promise<string | null> {
    const [notes, messages, participations] = await Promise.all([
      this.prisma.raw.providerNote.count({ where: { authorUserId: id } }),
      this.prisma.raw.chatMessage.count({ where: { authorUserId: id } }),
      this.prisma.raw.chatParticipant.count({ where: { userId: id } }),
    ]);

    if (notes) return `it wrote ${notes} clinical note${notes === 1 ? '' : 's'}`;
    if (messages) return `it sent ${messages} message${messages === 1 ? '' : 's'}`;
    if (participations) return 'it took part in a patient conversation';
    return null;
  }

  private async mustBeManageable(id: string) {
    const user = await this.prisma.raw.user.findUnique({
      where: { id },
      select: { ...FIELDS, email: true },
    });
    if (!user) throw new NotFoundException('That account does not exist');
    if (user.role === Role.OWNER) {
      throw new BadRequestException('An owner cannot be changed from here');
    }
    if (user.role !== Role.SUPER_ADMIN) {
      throw new BadRequestException('That account is not a super admin');
    }
    return user;
  }
}
