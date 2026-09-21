import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebhookBody, WebhookEvent } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';
import { DomainEvent } from '@/shared/events/domain-events';
import type { DomainEventEnvelope } from '@/shared/events/domain-events';
import {
  WEBHOOK_FAILURE_LIMIT,
  nextRetryAt,
  postWebhook,
  type DeliveryAttempt,
} from './webhook-sender';

/**
 * Tells a client business what happened, as it happens.
 *
 * The platform already narrates a visit to the patient in their chat thread.
 * These are the same moments, posted to the client's own systems so their CRM
 * can show a patient and a salesperson where a visit has got to — without them
 * polling us, and without a person copying a status between two screens.
 *
 * Every handler here is a subscriber, never a caller: a client's endpoint being
 * slow or down must not slow a clinician signing a prescription, and a delivery
 * that fails is retried on its own rather than failing the thing that caused it.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  /**
   * One promise chain per endpoint, so a client is never posted to in parallel.
   *
   * Two events raised in the same moment — a prescription signed and the visit
   * concluding — would otherwise arrive as two simultaneous connections, which
   * a modest CRM handles by dropping one. Chained, they arrive one after the
   * other, and a slow endpoint delays only its own traffic.
   *
   * This orders *delivery*, not causation: the handlers above each read the
   * database before sending, so two events raised together can still enter the
   * queue either way round. Every body carries `occurredAt` for exactly that
   * reason — it, not arrival order, is what a timeline should be built from.
   */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
  ) {}

  // ── the moments a client hears about ──────────────────────────────────

  @OnEvent(DomainEvent.VisitReceived)
  async onVisitReceived(envelope: DomainEventEnvelope<{ requestId: string }>) {
    const visit = await this.visitOf(envelope.payload.requestId);
    if (!visit) return;

    await this.send(visit, {
      masterId: visit.externalMasterId,
      event: 'CONSULT_RECEIVED',
      occurredAt: envelope.occurredAt,
    });
  }

  @OnEvent(DomainEvent.VisitApproved)
  async onVisitApproved(envelope: DomainEventEnvelope<{ requestId: string }>) {
    await this.concluded(envelope.payload.requestId, envelope.occurredAt);
  }

  @OnEvent(DomainEvent.VisitDenied)
  async onVisitDenied(envelope: DomainEventEnvelope<{ requestId: string }>) {
    await this.concluded(envelope.payload.requestId, envelope.occurredAt);
  }

  /**
   * One conclusion per visit, whichever way it went.
   *
   * `referred` and `refused` are told apart deliberately. The incumbent
   * reported only "prescribed" or "referred", which left a clinician declining
   * to treat looking identical to one sending the patient elsewhere — and those
   * are different conversations for whoever picks the patient up.
   */
  private async concluded(requestId: string, occurredAt: string) {
    const visit = await this.visitOf(requestId);
    if (!visit) return;

    const outcome = visit.referredAt
      ? 'referred'
      : visit.prescriptions.length
        ? 'prescribed'
        : 'refused';

    await this.send(visit, {
      masterId: visit.externalMasterId,
      event: 'CONSULT_CONCLUDED',
      occurredAt,
      visitOutcome: outcome,
      ...(visit.referralReason || visit.denialReason
        ? { reason: visit.referralReason ?? visit.denialReason ?? '' }
        : {}),
    });
  }

  @OnEvent(DomainEvent.PrescriptionSigned)
  async onPrescriptionSigned(
    envelope: DomainEventEnvelope<{ prescriptionId: string; requestId: string }>,
  ) {
    const visit = await this.visitOf(envelope.payload.requestId);
    if (!visit) return;

    const prescription = await runWithoutTenantScope(() =>
      this.prisma.raw.prescription.findUnique({
        where: { id: envelope.payload.prescriptionId },
        select: {
          id: true,
          dose: true,
          quantity: true,
          refills: true,
          daysSupply: true,
          sig: true,
          providerNameSnapshot: true,
          provider: { select: { npi: true } },
          medication: { select: { medId: true, name: true, strength: true } },
          requestItem: { select: { nameText: true, strength: true } },
        },
      }),
    );
    if (!prescription) return;

    await this.send(visit, {
      masterId: visit.externalMasterId,
      event: 'RX_WRITTEN',
      occurredAt: envelope.occurredAt,
      docName: prescription.providerNameSnapshot,
      docNpi: prescription.provider?.npi ?? null,
      medsPrescribed: [
        {
          // What the client called it, falling back to our catalogue name.
          name: prescription.requestItem?.nameText ?? prescription.medication.name,
          strength: prescription.requestItem?.strength ?? prescription.medication.strength ?? '',
          refills: String(prescription.refills),
          quantity: prescription.quantity,
          // The platform id they ordered by. Never the pharmacy's kit code:
          // that is a different string and one they cannot order against.
          medId: prescription.medication.medId,
          rxId: prescription.id,
          sig: prescription.sig,
          daysSupply: prescription.daysSupply === null ? 'N/A' : String(prescription.daysSupply),
        },
      ],
    });
  }

  @OnEvent(DomainEvent.OrderSubmitted)
  async onOrderSubmitted(envelope: DomainEventEnvelope<{ orderId: string }>) {
    const order = await this.orderOf(envelope.payload.orderId);
    if (!order) return;

    await this.send(order.visit, {
      masterId: order.visit.externalMasterId,
      event: 'PHARMACY_ORDER_IN_FULFILLMENT',
      occurredAt: envelope.occurredAt,
      orderId: order.id,
    });
  }

  @OnEvent(DomainEvent.OrderShipped)
  async onOrderShipped(
    envelope: DomainEventEnvelope<{
      orderId: string;
      carrier: string | null;
      trackingNumber: string | null;
    }>,
  ) {
    const order = await this.orderOf(envelope.payload.orderId);
    if (!order) return;

    await this.send(order.visit, {
      masterId: order.visit.externalMasterId,
      event: 'PHARMACY_ORDER_SHIPPED',
      occurredAt: envelope.occurredAt,
      orderId: order.id,
      info: {
        carrier: envelope.payload.carrier,
        tracking: envelope.payload.trackingNumber,
      },
    });
  }

  /**
   * Wired, and currently unreachable.
   *
   * Nothing publishes `OrderDelivered` yet — we take a tracking number from the
   * pharmacy but do not subscribe to the carrier's feed, so no code marks an
   * order delivered. Left connected so the event flows the day that arrives,
   * rather than being remembered then.
   */
  @OnEvent(DomainEvent.OrderDelivered)
  async onOrderDelivered(envelope: DomainEventEnvelope<{ orderId: string }>) {
    const order = await this.orderOf(envelope.payload.orderId);
    if (!order) return;

    await this.send(order.visit, {
      masterId: order.visit.externalMasterId,
      event: 'PHARMACY_ORDER_DELIVERED',
      occurredAt: envelope.occurredAt,
      orderId: order.id,
    });
  }

  // ── delivery ──────────────────────────────────────────────────────────

  /**
   * Sends one event to every endpoint of that client subscribed to it.
   *
   * Errors are swallowed on purpose. This runs as a subscriber to something a
   * clinician or a pharmacy just did, and a client's CRM being unreachable is
   * not a reason to fail the act that caused the event. What fails is recorded
   * and retried.
   */
  private async send(
    visit: { id: string; tenantId: string },
    body: WebhookBody,
  ): Promise<void> {
    try {
      const endpoints = await runWithoutTenantScope(() =>
        this.prisma.raw.tenantWebhook.findMany({
          where: {
            tenantId: visit.tenantId,
            isActive: true,
            disabledAt: null,
            events: { has: body.event },
          },
        }),
      );

      for (const endpoint of endpoints) {
        const queued = (this.queues.get(endpoint.id) ?? Promise.resolve())
          .catch(() => undefined)
          .then(() => this.deliver(endpoint, body, visit.id));

        this.queues.set(endpoint.id, queued);
        // Awaited so an event raised later in the same request queues behind
        // this one rather than racing it.
        await queued;
      }
    } catch (error) {
      this.logger.error(`Could not dispatch ${body.event}`, (error as Error).stack);
    }
  }

  /** One attempt at one endpoint, recorded either way. */
  private async deliver(
    endpoint: {
      id: string;
      url: string;
      authCipher: string;
      secretRef: string;
      failureCount: number;
    },
    body: WebhookBody,
    requestId: string,
  ): Promise<void> {
    const bearer = this.phi.decrypt(endpoint.authCipher);

    const attempt: DeliveryAttempt = await postWebhook(endpoint.url, body, {
      bearer,
      signingSecret: endpoint.secretRef,
    });

    const now = new Date();

    await runWithoutTenantScope(async () => {
      await this.prisma.raw.webhookDelivery.create({
        data: {
          webhookId: endpoint.id,
          event: body.event,
          // The body as it went, so "we never got that" can be answered.
          payload: body as unknown as object,
          responseStatus: attempt.status || null,
          responseBody: attempt.responseBody,
          lastError: attempt.error,
          attempts: 1,
          requestId,
          deliveredAt: attempt.ok ? now : null,
          nextRetryAt: attempt.ok || !attempt.retryable ? null : nextRetryAt(1, now),
        },
      });

      const failures = attempt.ok ? 0 : endpoint.failureCount + 1;
      const giveUp = failures >= WEBHOOK_FAILURE_LIMIT;

      await this.prisma.raw.tenantWebhook.update({
        where: { id: endpoint.id },
        data: {
          lastAttemptAt: now,
          failureCount: failures,
          ...(attempt.ok ? { lastSuccessAt: now, lastError: null } : { lastError: attempt.error }),
          // An endpoint that has failed this many times in a row is not coming
          // back on its own. Switching it off stops us posting a patient's
          // information at an address that may no longer belong to them.
          ...(giveUp
            ? {
                disabledAt: now,
                disabledReason: `Switched off after ${failures} consecutive failures. Last: ${attempt.error ?? 'unknown'}`,
              }
            : {}),
        },
      });
    });

    if (!attempt.ok) {
      // The URL, not the body: a failure line must never carry patient data.
      this.logger.warn(`${body.event} to ${endpoint.url} failed — ${attempt.error}`);
    }
  }

  // ── lookups ───────────────────────────────────────────────────────────

  private visitOf(requestId: string) {
    return runWithoutTenantScope(() =>
      this.prisma.raw.prescriptionRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          tenantId: true,
          externalMasterId: true,
          referredAt: true,
          referralReason: true,
          denialReason: true,
          prescriptions: { select: { id: true }, take: 1 },
        },
      }),
    );
  }

  private async orderOf(orderId: string) {
    const order = await runWithoutTenantScope(() =>
      this.prisma.raw.pharmacyOrder.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          prescription: {
            select: {
              request: {
                select: { id: true, tenantId: true, externalMasterId: true },
              },
            },
          },
        },
      }),
    );

    if (!order?.prescription.request) return null;
    return { id: order.id, visit: order.prescription.request };
  }
}

/** Narrower than the event names — these are the ones a client can subscribe to. */
export type DispatchableEvent = WebhookEvent;
