import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';

/**
 * Bounded context: messaging.
 *
 * Owns conversations, their participants, and real-time delivery.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway],
  exports: [MessagingService],
})
export class MessagingModule {}
