import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser, PlatformPermission } from '@health-emr/types';
import { PERMISSION_LABELS, hasPermission } from '@health-emr/types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Fine gate: may this particular administrator take this particular action?
 *
 * Runs after the roles guard, so by the time it is reached the caller is
 * already somebody who belongs here. What it adds is the division of authority
 * between them — an owner holds every grant, and a super admin holds the ones
 * an owner handed over.
 *
 * The refusal names the missing grant. "Forbidden" sends an administrator to
 * ask why; "you do not have: delete accounts permanently" sends them to ask
 * for it, which is the conversation that should happen.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<PlatformPermission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Authentication required');

    // No query here: the token strategy already re-read this user from the
    // database on this request, so `permissions` is current rather than
    // whatever was true when the token was minted.
    const missing = required.filter((permission) => !hasPermission(user, permission));
    if (missing.length) {
      throw new ForbiddenException(
        `You have not been given permission to ${missing
          .map((permission) => PERMISSION_LABELS[permission].label.toLowerCase())
          .join(' or ')}. An owner can grant it.`,
      );
    }
    return true;
  }
}
