import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@health-emr/types';

export interface RequestContext {
  requestId: string;
  userId: string | null;
  role: Role | null;
  /** The tenant this request is confined to. null means platform scope. */
  tenantId: string | null;
  /** True when the caller is a tenant's server using an API key, not a person. */
  isPartnerRequest: boolean;
  ip: string | null;
  userAgent: string | null;
  /**
   * Set once a handler has written its own audit entry, so the catch-all
   * interceptor knows not to add a second, thinner one for the same action.
   */
  audited: boolean;
}

/**
 * Ambient per-request state.
 *
 * The Prisma tenant extension reads `tenantId` from here rather than taking it
 * as an argument, so a developer cannot forget to pass it.
 *
 * The store is opened by RequestContextMiddleware — middleware, not a guard,
 * because `AsyncLocalStorage.run()` only keeps the store alive for the duration
 * of its callback. Express middleware can wrap `next()` inside that callback and
 * so covers the whole request; a guard that called `run()` would close the scope
 * the moment it returned, and every query in the handler would run unscoped.
 *
 * Guards therefore *mutate* the store (same object reference) rather than
 * opening a new one.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function currentTenantId(): string | null {
  return requestContext.getStore()?.tenantId ?? null;
}

/** Narrow the request to a tenant. Called by TenantGuard and the partner guard. */
export function setTenantScope(tenantId: string | null): void {
  const store = requestContext.getStore();
  if (store) store.tenantId = tenantId;
}

/** Marks this request as already audited by the code that handled it. */
export function markAudited(): void {
  const store = requestContext.getStore();
  if (store) store.audited = true;
}

export function setActor(userId: string | null, role: Role | null): void {
  const store = requestContext.getStore();
  if (store) {
    store.userId = userId;
    store.role = role;
  }
}

/**
 * Escape hatch for deliberate platform-wide work: Super Admin reads, scheduled
 * jobs, seeds. Restores the previous scope afterwards, including when `fn` throws.
 */
export async function runWithoutTenantScope<T>(fn: () => Promise<T> | T): Promise<T> {
  const store = requestContext.getStore();
  if (!store) return fn();

  const previous = store.tenantId;
  store.tenantId = null;
  try {
    return await fn();
  } finally {
    store.tenantId = previous;
  }
}

/** Open a fresh scope. Used by the middleware and by background jobs. */
export function runInContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}
