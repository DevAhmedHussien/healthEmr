import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';

/**
 * Invitations.
 *
 * Every account the platform creates for somebody else — a tenant owner, an
 * approved provider, an approved pharmacy — is created *locked*: the password is
 * random bytes that are hashed and immediately discarded. The only way in is a
 * single-use invite the recipient redeems to set their own.
 *
 * That property is what keeps the audit log meaningful. If a Super Admin could
 * set someone's password, "who did this" would never have a trustworthy answer.
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A password nobody knows, not even us. */
  static async lockedPassword(): Promise<string> {
    return argon2.hash(randomBytes(32).toString('base64'), { type: argon2.argon2id });
  }

  /**
   * Creates a user in the locked state, or returns the existing one when the
   * address is already ours at the same role.
   */
  async createLockedUser(input: {
    email: string;
    role: Role;
    firstName: string;
    lastName: string;
    phone?: string | null;
    tenantId?: string | null;
    pharmacyId?: string | null;
  }): Promise<{ userId: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.prisma.raw.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (existing) {
      if (existing.role !== input.role) {
        throw new ConflictException(
          `${email} already belongs to a ${existing.role} account, so it cannot also be a ${input.role}`,
        );
      }
      return { userId: existing.id, created: false };
    }

    const user = await this.prisma.raw.user.create({
      data: {
        email,
        passwordHash: await InviteService.lockedPassword(),
        role: input.role,
        tenantId: input.tenantId ?? null,
        pharmacyId: input.pharmacyId ?? null,
        firstName: input.firstName,
        lastName: input.lastName || '—',
        phone: input.phone ?? null,
        isEmailVerified: false,
        // Inactive until they accept: an account nobody has claimed should not
        // be able to sign in even if a password were somehow set on it.
        isActive: false,
      },
      select: { id: true },
    });

    return { userId: user.id, created: true };
  }

  /**
   * Issues a fresh invite, revoking any outstanding one first so an older link
   * stops working the moment a new one is sent.
   */
  async issue(userId: string, invitedByUserId: string | null, ttlDays = 7): Promise<string> {
    const plain = randomBytes(32).toString('base64url');

    await this.prisma.raw.$transaction([
      this.prisma.raw.userInvite.updateMany({
        where: { userId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.raw.userInvite.create({
        data: {
          userId,
          tokenHash: createHash('sha256').update(plain).digest('hex'),
          invitedByUserId,
          expiresAt: new Date(Date.now() + ttlDays * 24 * 3600 * 1000),
          lastSentAt: new Date(),
        },
      }),
    ]);

    await this.audit.record({
      action: 'INVITE_SENT',
      entityType: 'User',
      entityId: userId,
      actorUserId: invitedByUserId,
    });

    return plain;
  }

  /** Redeems an invite and sets the password the recipient chose. */
  async accept(token: string, password: string): Promise<{ email: string; role: Role }> {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const invite = await this.prisma.raw.userInvite.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) {
      // One message for every failure mode: a distinct "expired" versus
      // "already used" tells someone holding a stolen link which it is.
      throw new NotFoundException('This invitation is no longer valid');
    }

    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({
        where: { id: invite.user.id },
        data: {
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          isEmailVerified: true,
          isActive: true,
        },
      }),
      this.prisma.raw.userInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: 'INVITE_ACCEPTED',
      entityType: 'User',
      entityId: invite.user.id,
      actorUserId: invite.user.id,
    });

    return { email: invite.user.email, role: invite.user.role };
  }
}
