import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser, Role } from '@health-emr/types';
import { roleSatisfies } from '@health-emr/types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Coarse gate: may this role call this endpoint at all? */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Authentication required');

    // An owner is accepted wherever a super admin is, rather than being listed
    // beside them at every decorator — the one that got missed would be found
    // by a user rather than by a test.
    if (!required.some((role) => roleSatisfies(user.role, role))) {
      throw new ForbiddenException('Your role cannot perform this action');
    }
    return true;
  }
}
