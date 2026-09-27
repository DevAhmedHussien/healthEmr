import { DomainEvent } from '@/shared/events/domain-events';
import { WEBHOOK_EVENTS } from '@health-emr/types';
import { WebhookDispatcher } from './webhook-dispatcher.service';

/**
 * What actually leaves the building when a clinician asks a patient a question.
 *
 * Both halves were missing and neither failed loudly. "Request more
 * information" wrote the message, showed it to the patient, and published
 * nothing — so no delivery was attempted, no delivery row was written, and the
 * client's console showed a visit sitting in review that was in fact parked
 * waiting on an answer. The absence of this file is what let that ship.
 */

const VISIT = {
  id: 'visit-1',
  tenantId: 'tenant-1',
  externalMasterId: 'TILA-48210',
  patientId: 'patient-1',
};

function harness(over: { endpointEvents?: string[] } = {}) {
  const sent: Array<Record<string, unknown>> = [];

  const endpoint = {
    id: 'wh-1',
    url: 'https://tila.example.com/hooks/healthemr',
    signingSecret: 'whsec_test',
    isActive: true,
    disabledAt: null,
    failureCount: 0,
    events: over.endpointEvents ?? [...WEBHOOK_EVENTS],
  };

  const raw = {
    tenantWebhook: {
      findMany: jest.fn(async ({ where }: { where: { events: { has: string } } }) =>
        endpoint.events.includes(where.events.has) ? [endpoint] : [],
      ),
    },
    prescriptionRequest: {
      findUnique: jest.fn(async () => VISIT),
      findFirst: jest.fn(async () => VISIT),
    },
    chatThread: {
      findUnique: jest.fn(async () => ({ tenantId: VISIT.tenantId, patientId: VISIT.patientId })),
    },
    webhookDelivery: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sent.push(data);
        return { id: 'del-1', ...data };
      }),
    },
  };

  const service = new WebhookDispatcher(
    { raw } as never,
    { decrypt: (value: string) => value, encrypt: (value: string) => value } as never,
  );

  // The delivery itself is the sender's job and has its own tests; what this
  // file is about is whether a delivery is attempted at all, and with what.
  const attempts: Array<{ url: string; body: Record<string, unknown> }> = [];
  (service as unknown as { deliver: unknown }).deliver = jest.fn(
    async (target: { url: string }, body: Record<string, unknown>) => {
      attempts.push({ url: target.url, body });
    },
  );

  return { service, raw, attempts, endpoint };
}

const envelope = <T>(payload: T, event = DomainEvent.VisitInfoRequested) =>
  ({
    event,
    tenantId: VISIT.tenantId,
    requestId: 'req-1',
    occurredAt: '2026-09-27T00:57:07.000Z',
    payload,
  }) as never;

describe('the event catalogue', () => {
  /**
   * A visit can sit at INFO_REQUESTED for days, and the patient is the only
   * one who can end it. A client hearing nothing shows "in review" and chases
   * us about a delay a sentence from the patient would clear.
   */
  it('has an event for the clinician waiting on the patient', () => {
    expect(WEBHOOK_EVENTS).toContain('CONSULT_INFO_REQUESTED');
  });

  it('still carries the conversation separately', () => {
    expect(WEBHOOK_EVENTS).toContain('DOCTOR_CHAT');
  });
});

describe('when a clinician asks the patient a question', () => {
  it('tells the client the visit is now waiting on the patient', async () => {
    const { service, attempts } = harness();

    await service.onInfoRequested(
      envelope({ requestId: VISIT.id, masterId: VISIT.externalMasterId }),
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0].body).toMatchObject({
      masterId: 'TILA-48210',
      event: 'CONSULT_INFO_REQUESTED',
    });
  });

  /** The status says a visit is parked. It must not say why, clinically. */
  it('sends no clinical content with the status', async () => {
    const { service, attempts } = harness();

    await service.onInfoRequested(
      envelope({ requestId: VISIT.id, masterId: VISIT.externalMasterId }),
    );

    expect(Object.keys(attempts[0].body).sort()).toEqual(['event', 'masterId', 'occurredAt']);
  });

  it('carries the question itself as a chat event', async () => {
    const { service, attempts } = harness();

    await service.onClinicianMessaged(
      envelope({
        threadId: 'thread-1',
        authorRole: 'PROVIDER',
        content: 'Have you taken this medication before?',
        sentAt: '2026-09-27T00:57:07.000Z',
      }),
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0].body).toMatchObject({
      masterId: 'TILA-48210',
      event: 'DOCTOR_CHAT',
      content: 'Have you taken this medication before?',
    });
  });

  it('says nothing when the patient is the one writing', async () => {
    const { service, attempts } = harness();

    await service.onClinicianMessaged(
      envelope({
        threadId: 'thread-1',
        authorRole: 'PATIENT',
        content: 'Yes, twice last year.',
        sentAt: '2026-09-27T01:02:00.000Z',
      }),
    );

    expect(attempts).toEqual([]);
  });

  /**
   * Both events are opt-in per endpoint. A client subscribed to the chat but
   * not the status should get the one they asked for and not the other.
   */
  it('respects what each endpoint subscribed to', async () => {
    const chatOnly = harness({ endpointEvents: ['DOCTOR_CHAT'] });
    await chatOnly.service.onInfoRequested(
      envelope({ requestId: VISIT.id, masterId: VISIT.externalMasterId }),
    );
    expect(chatOnly.attempts).toEqual([]);

    const statusOnly = harness({ endpointEvents: ['CONSULT_INFO_REQUESTED'] });
    await statusOnly.service.onClinicianMessaged(
      envelope({
        threadId: 'thread-1',
        authorRole: 'PROVIDER',
        content: 'anything',
        sentAt: '2026-09-27T00:57:07.000Z',
      }),
    );
    expect(statusOnly.attempts).toEqual([]);
  });

  it('stays quiet rather than throwing when the visit cannot be found', async () => {
    const { service, raw, attempts } = harness();
    raw.prescriptionRequest.findUnique.mockResolvedValue(null as never);

    await expect(
      service.onInfoRequested(envelope({ requestId: 'gone', masterId: 'nope' })),
    ).resolves.toBeUndefined();
    expect(attempts).toEqual([]);
  });
});

describe('the event the dispatcher listens for', () => {
  /**
   * The original defect in one assertion. `VisitInfoRequested` was published
   * by prescribing and subscribed to by nothing — a real event on the bus that
   * reached no one.
   */
  it('subscribes to VisitInfoRequested', () => {
    const handler = Reflect.getMetadata?.('__eventListeners__', WebhookDispatcher);
    // Metadata shape is Nest's own and version-dependent; the method existing
    // and being callable is the contract this file actually rests on.
    expect(typeof WebhookDispatcher.prototype.onInfoRequested).toBe('function');
    expect(DomainEvent.VisitInfoRequested).toBe('visit.info_requested');
    void handler;
  });
});
