import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service';
import { currentContext } from '../auth/request-context';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The backstop: records an entry for any mutating request, or any break-the-glass
 * read, that the handler did not record itself.
 *
 * It stands down when the handler already wrote one. That entry names the record
 * and carries before/after; this one can only name the route and the method, so
 * emitting both doubled the length of the trail and buried the useful half. The
 * guarantee is unchanged — nothing that changes state goes unrecorded — but the
 * detailed entry wins where there is one.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const isMutation = MUTATING.has(request.method);
    const isBreakTheGlass = Boolean(request.breakTheGlass);

    if (!isMutation && !isBreakTheGlass) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          const ctx = currentContext();
          if (ctx?.audited) return;

          const action: AuditAction = isBreakTheGlass
            ? 'BREAK_THE_GLASS'
            : this.actionFor(request.method);

          void this.audit.record({
            action,
            entityType: `${request.method} ${request.route?.path ?? request.url}`,
            entityId: request.params?.id ?? null,
            patientId: request.params?.patientId ?? null,
            tenantId: ctx?.tenantId ?? null,
          });
        },
      }),
    );
  }

  private actionFor(method: string): AuditAction {
    if (method === 'DELETE') return 'PHI_DELETED';
    if (method === 'POST') return 'PHI_CREATED';
    return 'PHI_UPDATED';
  }
}
