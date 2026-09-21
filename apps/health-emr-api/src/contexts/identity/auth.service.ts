import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { AuthTokens, AuthenticatedUser } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { TokensService } from './tokens.service';

/**
 * Ten wrong passwords for one account, then a minute's wait.
 *
 * Ten is above any realistic typo rate and far below what makes guessing
 * worthwhile: a five-character-entropy password would still take years.
 */
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 60_000;

const GENERIC_FAILURE = 'Email or password is incorrect';

/** argon2id with parameters sized for an interactive login on modest hardware. */
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON_OPTIONS);
  }

  /**
   * Refuses a password field that is being worked through.
   *
   * Counted per account rather than per address, and read from the failures
   * already in the audit trail rather than from a second store that could
   * disagree with it.
   *
   * Per account matters in both directions. A clinic sits behind one address,
   * so counting per address locks out the eleventh clinician after a shift
   * change — which forces the limit up until it protects nothing. And guessing
   * is aimed at one account, which is where the budget needs to be small.
   *
   * The window is short on purpose. A long lockout is a way for anybody to
   * deny a named clinician their account by guessing at it, which trades a
   * break-in risk for an outage during a shift.
   */
  private async refuseIfUnderAttack(email: string): Promise<void> {
    const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);

    const recent = await this.prisma.raw.auditLog.count({
      where: {
        action: 'LOGIN_FAILED',
        createdAt: { gte: since },
        OR: [
          // A wrong password on a real account records the account.
          { actorEmail: email },
          // An address that does not exist records only what was typed, so the
          // attempt is still counted against it.
          { after: { path: ['email'], equals: email } },
        ],
      },
    });

    if (recent >= MAX_FAILED_ATTEMPTS) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        after: { email, reason: 'rate_limited', recent },
      });

      throw new HttpException(
        'Too many sign-in attempts for this account. Wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async login(
    email: string,
    password: string,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const normalised = email.trim().toLowerCase();

    await this.refuseIfUnderAttack(normalised);

    // `raw` because login happens before any tenant is known.
    const user = await this.prisma.raw.user.findUnique({ where: { email: normalised } });

    // Verify against a dummy hash when the user is missing so the response time
    // does not reveal whether the address exists.
    if (!user) {
      await argon2.verify(await AuthService.hashPassword('no-such-user'), 'wrong').catch(() => false);
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        after: { email: normalised, reason: 'unknown_email' },
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid || !user.isActive) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
        after: { reason: valid ? 'inactive' : 'bad_password' },
      });
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const sessionId = this.tokens.newSessionId();
    const issued = await this.tokens.issue({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      sessionId,
    });

    await this.prisma.raw.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: issued.refreshTokenHash,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + issued.refreshExpiresIn * 1000),
      },
    });

    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      action: 'LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      tenantId: user.tenantId,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
      },
      tokens: {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresIn: issued.expiresIn,
        refreshExpiresIn: issued.refreshExpiresIn,
      },
    };
  }

  /**
   * Rotating refresh: the presented token is revoked and a new one issued in the
   * same transaction, so a stolen token is usable at most once and its reuse
   * shows up as a revoked-session error.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);

    const session = await this.prisma.raw.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    const sessionId = this.tokens.newSessionId();
    const issued = await this.tokens.issue({
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
      tenantId: session.user.tenantId,
      sessionId,
    });

    await this.prisma.raw.$transaction([
      this.prisma.raw.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.raw.refreshSession.create({
        data: {
          id: sessionId,
          userId: session.user.id,
          tokenHash: issued.refreshTokenHash,
          userAgent: session.userAgent,
          ip: session.ip,
          expiresAt: new Date(Date.now() + issued.refreshExpiresIn * 1000),
        },
      }),
    ]);

    await this.audit.record({
      action: 'REFRESH_TOKEN_ROTATED',
      entityType: 'RefreshSession',
      entityId: sessionId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      tenantId: session.user.tenantId,
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
      refreshExpiresIn: issued.refreshExpiresIn,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.raw.refreshSession.findUnique({ where: { tokenHash } });
    if (!session) return;

    await this.prisma.raw.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      action: 'LOGOUT',
      entityType: 'RefreshSession',
      entityId: session.id,
      actorUserId: session.userId,
    });
  }
  /**
   * The fuller record behind the signed-in identity.
   *
   * Read fresh rather than taken from the token: a role changed or an account
   * deactivated an hour ago should show here now, not at the next refresh.
   */
  async profileFor(userId: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true, phone: true,
        isEmailVerified: true, isActive: true, lastLoginAt: true, createdAt: true,
        tenant: { select: { name: true, slug: true } },
      },
    });

    return {
      ...user,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
