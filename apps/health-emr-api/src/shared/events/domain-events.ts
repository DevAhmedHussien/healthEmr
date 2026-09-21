/**
 * The contract between bounded contexts.
 *
 * Two *peer* contexts do not call each other — they publish and subscribe here.
 * That is what keeps the seams clean enough to lift one out into its own
 * deployable later: today the bus is in-process, and swapping it for SQS, NATS
 * or Kafka means reimplementing one class rather than rewriting callers.
 *
 * Three kinds of direct import are deliberate and are not peer calls:
 *
 *  - **Shared capabilities.** `notifications`, `identity` and `tenancy` are
 *    used by several contexts the way `prisma` is. Routing them through events
 *    would mean a context could not learn whether a message was accepted.
 *  - **Composition layers.** `super-admin` and `partner-api` own no tables;
 *    they compose the others behind a console and a public contract. That is
 *    their whole job.
 *  - **`prescribing` → `messaging`**, so a clinician can ask a patient a
 *    question. The question has to reach a specific thread and the caller needs
 *    the thread id back, which a fire-and-forget event cannot give it. The
 *    reverse direction *is* an event: messaging knows nothing about visits, and
 *    prescribing subscribes to `chat.message` to take a visit off hold.
 */
export const DomainEvent = {
  VisitReceived: 'visit.received',
  VisitAssigned: 'visit.assigned',
  VisitUnassignable: 'visit.unassignable',
  VisitInfoRequested: 'visit.info_requested',
  VisitApproved: 'visit.approved',
  VisitDenied: 'visit.denied',
  PrescriptionSigned: 'prescription.signed',
  OrderSubmitted: 'order.submitted',
  OrderRejected: 'order.rejected',
  OrderShipped: 'order.shipped',
  OrderDelivered: 'order.delivered',
  ChatMessageSent: 'chat.message',
} as const;

export type DomainEventName = (typeof DomainEvent)[keyof typeof DomainEvent];

export interface DomainEventEnvelope<T = unknown> {
  event: DomainEventName;
  tenantId: string | null;
  /** Correlates every event produced while handling one inbound request. */
  requestId: string | null;
  occurredAt: string;
  payload: T;
}
