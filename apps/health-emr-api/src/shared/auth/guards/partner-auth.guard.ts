import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PARTNER_KEY } from '../decorators/partner.decorator';
import { TenantApiKeyService } from '@/contexts/tenancy/tenant-api-key.service';
import { setTenantScope } from '../request-context';

/**
 * Authenticates a tenant's backend by API key and pins the request to that
 * tenant — the mechanism behind Beluga's "No company found".
 *
 * The presented key is never compared in full against the database: a short
 * non-secret prefix finds the row, then argon2 verifies the rest in constant
 * time.
 */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: TenantApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPartner = this.reflector.getAllAndOverride<boolean>(PARTNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPartner) return true;

    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization as string | undefined;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key');
    }

    const resolved = await this.apiKeys.resolve(header.slice(7).trim());
    if (!resolved) {
      throw new UnauthorizedException('Invalid API key');
    }

    request.tenantId = resolved.tenantId;
    request.tenantSlug = resolved.tenantSlug;
    request.isPartnerRequest = true;
    setTenantScope(resolved.tenantId);

    return true;
  }
}
