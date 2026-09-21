import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RoutingService } from './routing.service';

/**
 * Bounded context: practitioners.
 *
 * Owns provider profiles, per-state licensure, category qualification and the
 * routing engine that decides who may see a request.
 */
@Module({
  imports: [TenancyModule],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class PractitionersModule {}
