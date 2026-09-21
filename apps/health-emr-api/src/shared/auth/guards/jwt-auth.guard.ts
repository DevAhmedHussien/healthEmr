import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PARTNER_KEY } from '../decorators/partner.decorator';

/**
 * Authentication for user sessions.
 *
 * Note what is deliberately absent: there is no header that grants blanket
 * admin. Machine callers use scoped tenant API keys (PartnerAuthGuard) or
 * service accounts, both of which are revocable and audited.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    // Partner routes authenticate with an API key; PartnerAuthGuard handles them.
    const isPartner = this.reflector.getAllAndOverride<boolean>(PARTNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPartner) return true;

    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T): T {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
