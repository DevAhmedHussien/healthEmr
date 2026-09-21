import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The tenant this request is confined to. Null for platform-scope callers. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return (ctx.switchToHttp().getRequest().tenantId as string | null) ?? null;
});
