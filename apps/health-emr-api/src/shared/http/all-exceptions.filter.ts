import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentContext } from '../auth/request-context';

/**
 * One error shape for the whole API, and nothing leaks out of it.
 *
 * Unexpected errors are logged in full server-side and reported to the caller as
 * a bare 500 — a stack trace that mentions a column name or a patient id is a
 * disclosure, not a debugging aid.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = currentContext()?.requestId ?? null;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Partner routes answer in their own `{ status, error }` shape.
      if (typeof body === 'object' && body !== null && 'error' in body && 'status' in body) {
        response.status(status).json(body);
        return;
      }

      response.status(status).json({
        statusCode: status,
        message: typeof body === 'string' ? body : (body as any).message,
        ...(typeof body === 'object' ? { details: (body as any).details } : {}),
        requestId,
      });
      return;
    }

    this.logger.error(
      `Unhandled error on ${request.method} ${request.url} (requestId=${requestId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
      requestId,
    });
  }
}
