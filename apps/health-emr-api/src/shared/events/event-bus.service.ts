import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { currentContext } from '../auth/request-context';
import type { DomainEventEnvelope, DomainEventName } from './domain-events';

/**
 * In-process implementation of the domain event bus.
 *
 * Deliberately narrow: publish an envelope, subscribe by name. Nothing in the
 * callers depends on the transport, so moving a context to its own service is a
 * change to this file plus a queue, not a change to the domain code.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);

  constructor(private readonly emitter: EventEmitter2) {}

  publish<T>(event: DomainEventName, payload: T): void {
    const ctx = currentContext();
    const envelope: DomainEventEnvelope<T> = {
      event,
      tenantId: ctx?.tenantId ?? null,
      requestId: ctx?.requestId ?? null,
      occurredAt: new Date().toISOString(),
      payload,
    };

    this.logger.debug(`publish ${event}`);
    this.emitter.emit(event, envelope);
  }
}
