import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runInContext } from '../auth/request-context';

/**
 * Opens the AsyncLocalStorage scope for the request and keeps it open for the
 * whole chain by calling `next()` from inside it.
 *
 * Registered first in AppModule so guards, services and the audit interceptor
 * all share one context object.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const headerId = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(headerId) ? headerId[0] : headerId)?.trim() || randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    runInContext(
      {
        requestId,
        userId: null,
        role: null,
        tenantId: null,
        isPartnerRequest: false,
        audited: false,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      () => next(),
    );
  }
}
