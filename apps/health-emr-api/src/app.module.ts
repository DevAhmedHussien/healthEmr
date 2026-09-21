import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppConfigModule } from './shared/config/config.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { StorageModule } from './shared/storage/storage.module';
import { AuditModule } from './shared/audit/audit.module';
import { EventsModule } from './shared/events/events.module';

import { RequestContextMiddleware } from './shared/http/request-context.middleware';
import { AllExceptionsFilter } from './shared/http/all-exceptions.filter';
import { ZodValidationPipe } from './shared/http/zod-validation.pipe';
import { AuditInterceptor } from './shared/audit/audit.interceptor';
import { JwtAuthGuard } from './shared/auth/guards/jwt-auth.guard';
import { PartnerAuthGuard } from './shared/auth/guards/partner-auth.guard';
import { TenantGuard } from './shared/auth/guards/tenant.guard';
import { RolesGuard } from './shared/auth/guards/roles.guard';

import { IdentityModule } from './contexts/identity/identity.module';
import { TenancyModule } from './contexts/tenancy/tenancy.module';
import { PatientsModule } from './contexts/patients/patients.module';
import { PractitionersModule } from './contexts/practitioners/practitioners.module';
import { PrescribingModule } from './contexts/prescribing/prescribing.module';
import { PharmacyModule } from './contexts/pharmacy/pharmacy.module';
import { OnboardingModule } from './contexts/onboarding/onboarding.module';
import { NotificationsModule } from './contexts/notifications/notifications.module';
import { WebhooksModule } from './contexts/webhooks/webhooks.module';
import { MessagingModule } from './contexts/messaging/messaging.module';
import { AdminModule } from './contexts/admin/admin.module';
import { SuperAdminModule } from './contexts/super-admin/super-admin.module';
import { PartnerApiModule } from './contexts/partner-api/partner.module';
import { HealthModule } from './contexts/health/health.module';

/**
 * One deployable, many bounded contexts.
 *
 * Contexts talk to each other through the domain event bus and through exported
 * services — never by reaching into each other's tables. That keeps the seams
 * sharp enough to lift any one of them into its own service when traffic or team
 * size justifies it, without paying the distributed-systems cost today.
 *
 * Guard order matters and is declared here rather than per-controller:
 *   1. PartnerAuthGuard — resolves a tenant API key, if this is a partner route
 *   2. JwtAuthGuard     — resolves a user session otherwise
 *   3. TenantGuard      — pins the tenant scope the Prisma extension reads
 *   4. RolesGuard       — coarse role check
 *
 * Row-level access — "may THIS clinician open THIS chart" — is not a guard. It
 * is a `where` clause in the service that reads the record, so an unauthorised
 * chart is *not found* rather than forbidden, and the database never returns a
 * row the caller may not see. A global guard once stood here keyed on a
 * decorator no route ever carried, which made the chain read as though it
 * protected something it did not.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CryptoModule,
    StorageModule,
    AuditModule,
    EventsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    IdentityModule,
    TenancyModule,
    PatientsModule,
    PractitionersModule,
    PrescribingModule,
    PharmacyModule,
    OnboardingModule,
    NotificationsModule,
    MessagingModule,
    // Subscribes to the bus and posts outward. Registered here so its handlers
    // are live for every event, not only those raised under the Super Admin.
    WebhooksModule,
    AdminModule,
    SuperAdminModule,
    PartnerApiModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PartnerAuthGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // First in the chain: opens the AsyncLocalStorage scope everything else uses.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
