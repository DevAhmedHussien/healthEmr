import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventBus } from './event-bus.service';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: false, verboseMemoryLeak: true })],
  providers: [EventBus],
  exports: [EventBus],
})
export class EventsModule {}
