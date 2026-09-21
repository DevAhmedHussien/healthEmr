import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccessTokenClaims, AuthTokens, Role } from '@health-emr/types';
import { APP_CONFIG } from '@/shared/config/config.module';
import type { AppConfig } from '@/shared/config/configuration';

@Injectable()
export class TokensService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
  ) {}

  async issue(params: {
    userId: string;
    email: string;
    role: Role;
    tenantId: string | null;
    sessionId: string;
  }): Promise<AuthTokens & { refreshTokenHash: string }> {
    const claims: AccessTokenClaims = {
      sub: params.userId,
      email: params.email,
      role: params.role,
      tenantId: params.tenantId,
      sessionId: params.sessionId,
    };

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.jwt.accessSecret,
      // jsonwebtoken types `expiresIn` as a template-literal union it does not
      // export usefully; the value is validated by ttlSeconds() either way.
      expiresIn: this.config.jwt.accessTtl as unknown as number,
    });

    // Refresh tokens are opaque random bytes, not JWTs — nothing reads their
    // contents, and only the hash is persisted, so a database leak does not
    // hand out sessions.
    const refreshToken = randomBytes(48).toString('base64url');

    return {
      accessToken,
      refreshToken,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
      expiresIn: this.ttlSeconds(this.config.jwt.accessTtl),
      refreshExpiresIn: this.ttlSeconds(this.config.jwt.refreshTtl),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  newSessionId(): string {
    return randomUUID();
  }

  /** Accepts `15m`, `7d`, `90s`, `12h`, or a bare number of seconds. */
  ttlSeconds(ttl: string): number {
    const match = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
    if (!match) throw new Error(`Unrecognised TTL: ${ttl}`);

    const value = Number(match[1]);
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? 's'] ?? 1;
    return value * multiplier;
  }
}
