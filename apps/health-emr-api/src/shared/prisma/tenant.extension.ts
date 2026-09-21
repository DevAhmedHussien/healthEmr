import { Prisma } from '@prisma/client';
import { currentTenantId } from '../auth/request-context';
import { isTenantScoped } from './tenant-models';

/** Operations that read or mutate existing rows via a `where` clause. */
const WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);

/** Operations that bring new rows into being and so need the id stamped on. */
const CREATE_OPS = new Set(['create', 'createMany', 'upsert']);

/**
 * Tenant isolation, enforced by the data layer instead of by discipline.
 *
 * Every query against a tenant-scoped model gets `tenantId` merged into its
 * `where`, and every create gets it stamped into `data`. A service that forgets
 * its `where` clause returns that tenant's rows, not everyone's.
 *
 * Platform scope (Super Admin, cron, migrations) is expressed by running with a
 * null tenant in the request context — see `runWithoutTenantScope`.
 */
export const tenantExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = currentTenantId();

          if (!tenantId || !isTenantScoped(model)) {
            return query(args);
          }

          const next = { ...(args as Record<string, any>) };

          if (WHERE_OPS.has(operation)) {
            next.where = { ...(next.where ?? {}), tenantId };
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === 'createMany' && Array.isArray(next.data)) {
              next.data = next.data.map((row: Record<string, unknown>) => ({ ...row, tenantId }));
            } else if (operation === 'upsert') {
              next.create = { ...(next.create ?? {}), tenantId };
              next.update = { ...(next.update ?? {}) };
            } else if (next.data && !Array.isArray(next.data)) {
              next.data = { ...next.data, tenantId };
            }
          }

          return query(next);
        },
      },
    },
  }),
);
