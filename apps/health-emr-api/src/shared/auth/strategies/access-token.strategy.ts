import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenClaims, AuthenticatedUser } from '@health-emr/types';
import { APP_CONFIG } from '@/shared/config/config.module';
import type { AppConfig } from '@/shared/config/configuration';
import { PrismaService } from '@/shared/prisma/prisma.service';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  /**
   * The token is only a claim. We re-read the user so a deactivated account or a
   * changed role takes effect immediately rather than at the next token refresh.
   */
  async validate(payload: AccessTokenClaims): Promise<AuthenticatedUser> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, tenantId: true, isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const session = await this.prisma.raw.refreshSession.findUnique({
      where: { id: payload.sessionId },
      select: { revokedAt: true },
    });
    if (session?.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenantId: user.tenantId,
    };
  }
}
