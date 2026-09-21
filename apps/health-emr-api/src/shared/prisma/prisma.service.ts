import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant.extension';

/**
 * Puts the tenant guard on a client. Applied to the instance we already hold —
 * an extension is a view over the same connection pool, so building a second
 * client here would double the connections for no gain.
 */
function withTenantScope(client: PrismaClient) {
  return client.$extends(tenantExtension);
}

/** The extended client type, so services get accurate autocomplete. */
export type ExtendedPrismaClient = ReturnType<typeof withTenantScope>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** Tenant-scoped. This is what every service should use. */
  readonly client: ExtendedPrismaClient;
  /** Unscoped. Only for migrations, seeds and deliberate platform-wide reads. */
  readonly raw: PrismaClient;

  constructor() {
    this.raw = new PrismaClient({
      /**
       * `PRISMA_LOG_QUERIES=1` prints every statement with its duration.
       *
       * Kept behind a variable rather than tied to NODE_ENV: the question
       * "which of these forty queries is the slow one" comes up against a
       * production-shaped database, which is never running in development mode.
       * Never enable it where real traffic runs — statements carry parameters,
       * and parameters carry PHI.
       */
      log:
        process.env.PRISMA_LOG_QUERIES === '1'
          ? ['query', 'warn', 'error']
          : process.env.NODE_ENV === 'development'
            ? ['warn', 'error']
            : ['error'],
    });
    this.client = withTenantScope(this.raw);
  }

  async onModuleInit(): Promise<void> {
    await this.raw.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect();
  }
}
