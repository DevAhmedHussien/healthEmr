import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@health-emr/types';
import { Role } from '@health-emr/types';
import { currentContext, setActor, setTenantScope } from '../request-context';

/**
 * Decides the tenant scope for the request, then narrows the ambient context
 * that the Prisma extension reads.
 *
 *   ADMIN                       → confined to their own tenant
 *   partner API key             → confined to the key's tenant (set by PartnerAuthGuard)
 *   SUPER_ADMIN                 → platform scope; PHI reads are logged as break-the-glass
 *   PROVIDER / PHARMACY         → platform scope; the reading service scopes the rows
 *   PATIENT                     → platform scope; the portal reads their own id only
 *
 * Runs after JwtAuthGuard so `request.user` is populated, and inside the
 * middleware's scope so the mutation sticks for the rest of the request.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    // A partner guard may already have pinned the tenant from an API key.
    let tenantId: string | null = request.tenantId ?? null;

    if (!tenantId && user?.role === Role.ADMIN) {
      if (!user.tenantId) {
        throw new ForbiddenException('This admin account is not linked to a tenant');
      }
      tenantId = user.tenantId;
    }

    request.tenantId = tenantId;
    setTenantScope(tenantId);
    setActor(user?.id ?? null, user?.role ?? null);

    // Defensive: if the middleware did not run (misconfiguration), fail closed
    // rather than silently serving every tenant's rows.
    if (!currentContext()) {
      throw new ForbiddenException('Request context unavailable');
    }

    return true;
  }
}
