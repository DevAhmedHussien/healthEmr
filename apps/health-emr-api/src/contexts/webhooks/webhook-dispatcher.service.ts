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

  /**
   * The clinician wrote to the patient.
   *
   * Only the clinician's own words go out. A patient's reply is theirs and the
   * client already has it — they collected it. The platform's own status notes
   * ("your order has shipped") would arrive as a second copy of an event the
   * client was already sent, read by a support desk as the doctor saying it.
   *
   * The content travels, because a CRM showing half a conversation is worse
   * than showing none. That is a disclosure decision, which is why only an
   * owner can point a webhook at an endpoint in the first place.
   */
  @OnEvent(DomainEvent.ChatMessageSent)
  async onClinicianMessaged(
    envelope: DomainEventEnvelope<{
      threadId: string;
      authorRole: string;
      content: string;
      sentAt: Date | string;
    }>,
  ) {
    if (envelope.payload.authorRole !== 'PROVIDER') return;

    const visit = await this.visitForThread(envelope.payload.threadId);
    if (!visit) return;

    await this.send(visit, {
      masterId: visit.externalMasterId,
      event: 'DOCTOR_CHAT',
      occurredAt: new Date(envelope.payload.sentAt).toISOString(),
      content: envelope.payload.content,
    });
  }

  /**
   * The clinician is waiting on the patient.
   *
   * Sent alongside the DOCTOR_CHAT carrying the question, and deliberately
   * separate from it: one is the conversation, this is the state the visit is
   * now in. A client that only heard the message would show a chat bubble
   * against a visit still reading "in review", and their support desk would
   * chase us about a delay only the patient can end.
   *
   * Carries no clinical content. The question travels in the chat event, which
   * is already a disclosure decision an owner made when pointing a webhook at
   * an endpoint; the status needs no such argument and should not reopen it.
   */
  @OnEvent(DomainEvent.VisitInfoRequested)
  async onInfoRequested(
    envelope: DomainEventEnvelope<{ requestId: string; masterId: string }>,
  ) {
    const visit = await this.visitOf(envelope.payload.requestId);
    if (!visit) return;

    await this.send(visit, {
      masterId: visit.externalMasterId,
      event: 'CONSULT_INFO_REQUESTED',
      occurredAt: new Date(envelope.occurredAt ?? Date.now()).toISOString(),
    });
  }

  /**
   * The visit was withdrawn here.
   *
   * A client whose CRM still shows "in review" for a visit that no longer
   * exists will chase a patient about it, so this is sent even though the
   * client is usually the one who asked for the cancellation.
   */
  @OnEvent(DomainEvent.VisitVoided)
  async onVisitVoided(envelope: DomainEventEnvelope<{ requestId: string; reason?: string }>) {
    const visit = await this.visitOf(envelope.payload.requestId);
    if (!visit) return;

    await this.send(visit, {
      masterId: visit.externalMasterId,
      event: 'CONSULT_CANCELED',
      occurredAt: envelope.occurredAt ?? new Date().toISOString(),
      ...(envelope.payload.reason ? { reason: envelope.payload.reason } : {}),
    });
  }

  /**
   * A patient's name was corrected here.
   *
   * Sent per visit rather than once per patient: the client joins on masterId,
   * and a correction that arrives against no visit is one their CRM cannot
   * place. A patient with three visits produces three events, which is the
   * shape the client can actually act on.
   */
  @OnEvent(DomainEvent.PatientNameChanged)
  async onPatientNameChanged(
    envelope: DomainEventEnvelope<{ patientId: string; firstName: string; lastName: string }>,
  ) {
    const visits = await runWithoutTenantScope(() =>
      this.prisma.raw.prescriptionRequest.findMany({
        where: { patientId: envelope.payload.patientId, voidedAt: null },
        select: { id: true, tenantId: true, externalMasterId: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );

    for (const visit of visits) {
      await this.send(visit, {
        masterId: visit.externalMasterId,
        event: 'NAME_UPDATE',
        occurredAt: envelope.occurredAt ?? new Date().toISOString(),
        firstName: envelope.payload.firstName,
        lastName: envelope.payload.lastName,
      });
    }
  }

  /**
   * Where the parcel got to, as the carrier reports it.
   *
   * Distinct from PHARMACY_ORDER_SHIPPED, which says the pharmacy handed it
   * over. "Where is my package" is answered by these, not by that.
   */
  @OnEvent(DomainEvent.PackageTracked)
  async onPackageTracked(
    envelope: DomainEventEnvelope<{
      orderId: string;
      status: 'PACKAGE_IN_TRANSIT' | 'PACKAGE_OUT_FOR_DELIVERY' | 'PACKAGE_DELIVERED' | 'PACKAGE_DELIVERY_FAILED';
      trackerStatus?: string | null;
      trackerId?: string | null;
      trackingUrl?: string | null;
    }>,
  ) {
    const order = await this.orderOf(envelope.payload.orderId);
    if (!order) return;

    await this.send(order.visit, {
      masterId: order.visit.externalMasterId,
      event: envelope.payload.status,
      occurredAt: envelope.occurredAt ?? new Date().toISOString(),
      orderId: order.externalOrderId ?? order.id,
      info: {
        // Held here, so always answerable.
        tracking: order.trackingNumber ?? null,
        carrier: order.carrier ?? null,
        deliveredDate: order.deliveredAt ? order.deliveredAt.toISOString() : null,
        // Supplied by whoever reported the update, if they know. Null means we
        // do not know, which is the honest answer until a carrier-tracking
        // provider is connected.
        trackerStatus: envelope.payload.trackerStatus ?? null,
        trackerId: envelope.payload.trackerId ?? null,
        trackingUrl: envelope.payload.trackingUrl ?? null,
      },
    });
  }

  // ── lookups ───────────────────────────────────────────────────────────

  /**
   * The visit a conversation belongs to.
   *
   * A patient–clinician thread is keyed on the patient, not on a visit: one
   * conversation carries on across however many visits they have. The client
   * joins on masterId, so the message is attributed to their most recent visit
   * with that client — which is the one their CRM has open, and the one the
   * conversation is almost always about.
   */
  private async visitForThread(threadId: string) {
    const thread = await runWithoutTenantScope(() =>
      this.prisma.raw.chatThread.findUnique({
        where: { id: threadId },
        select: { tenantId: true, patientId: true },
      }),
    );
    if (!thread?.patientId || !thread.tenantId) return null;

    return runWithoutTenantScope(() =>
      this.prisma.raw.prescriptionRequest.findFirst({
        where: { patientId: thread.patientId!, tenantId: thread.tenantId!, voidedAt: null },
        select: { id: true, tenantId: true, externalMasterId: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }


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
          // Carried so a tracking event can answer where the parcel is without
          // a second query per delivery.
          externalOrderId: true,
          trackingNumber: true,
          carrier: true,
          deliveredAt: true,
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
    return {
      id: order.id,
      externalOrderId: order.externalOrderId,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      deliveredAt: order.deliveredAt,
      visit: order.prescription.request,
    };
  }
}

/** Narrower than the event names — these are the ones a client can subscribe to. */
export type DispatchableEvent = WebhookEvent;
