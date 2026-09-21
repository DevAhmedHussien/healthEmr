import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { DomainEvent } from '@/shared/events/domain-events';
import { PharmacyCredentialResolver } from './credentials';
import type { LifeFileOrder, LifeFileResult, LifeFileRx } from './lifefile.types';

const clip = (value: unknown, max: number): string =>
  value === null || value === undefined ? '' : String(value).slice(0, max);

/** LifeFile wants `(512) 555-0142`, and rejects anything else. */
function phone(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return clip(value, 16);
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function gender(value: string | null | undefined): 'm' | 'f' | 'u' {
  const lower = String(value ?? '').toLowerCase();
  if (lower.startsWith('m')) return 'm';
  if (lower.startsWith('f')) return 'f';
  return 'u';
}

/**
 * Sends a signed prescription to a pharmacy's LifeFile system.
 *
 * This is the step that was missing: a provider approved, an order was queued,
 * and nothing left the building. The pharmacy saw it only if somebody opened
 * our fill queue.
 *
 * Two rules are carried over from the production integration because both were
 * learned the hard way there:
 *
 * - **Directions are the SIG, always.** An internal note must never travel as
 *   directions; doing so once blanked the SIG on a real order and sent the
 *   clinician's private remark to the pharmacy as instructions to the patient.
 * - **Retry 5xx, never 4xx.** A rejected order is rejected because it is wrong,
 *   and resending it produces the same rejection plus a duplicate if the
 *   pharmacy partially accepted it.
 */
@Injectable()
export class LifeFileService {
  private readonly logger = new Logger(LifeFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
    private readonly credentials: PharmacyCredentialResolver,
    private readonly events: EventBus,
  ) {}

  /**
   * Transmits one queued order.
   *
   * Returns a result rather than throwing: a failure here must not roll back the
   * prescription, which is signed and valid whatever the pharmacy's API is
   * doing. The order stays queued with the reason recorded, so it can be retried
   * once the cause is fixed.
   */
  async transmit(orderId: string, options: { force?: boolean } = {}): Promise<LifeFileResult> {
    const order = await this.prisma.raw.pharmacyOrder.findUnique({
      where: { id: orderId },
      include: {
        pharmacy: { include: { config: true } },
        prescription: {
          include: {
            medication: true,
            patient: true,
            provider: {
              include: {
                user: true,
                licenses: { where: { status: 'ACTIVE' }, orderBy: { expiresAt: 'desc' } },
              },
            },
          },
        },
      },
    });

    if (!order) return this.failure(404, 'That order does not exist', false);

    // An order the pharmacy already accepted is never sent again. Retrying one
    // does not "fix" anything — it asks the pharmacy to fill a second time, and
    // the patient receives two parcels. This was not theoretical: retrying an
    // accepted order during testing produced a second order id from the same
    // prescription. A genuine resend is a deliberate act with `force`.
    if (order.externalOrderId && !options.force) {
      return {
        ok: true,
        status: 200,
        orderId: order.externalOrderId,
        rxNumber: order.externalRxNumber,
        error: null,
        retryable: false,
      };
    }

    const config = order.pharmacy.config;
    if (!config || !config.isEnabled) {
      // Not an error. A pharmacy without a live integration works its queue in
      // our own console instead, so the order has already reached them — the
      // order row *is* the delivery. Announcing it keeps the patient's account
      // of where their medication is true for both kinds of pharmacy.
      this.events.publish(DomainEvent.OrderSubmitted, {
        orderId: order.id,
        patientId: order.prescription.patientId,
        pharmacy: order.pharmacy.name,
        externalOrderId: null,
      });

      return this.failure(
        0,
        config
          ? `${order.pharmacy.name}'s integration is switched off; they work this from the console`
          : `${order.pharmacy.name} has no integration; they work this from the console`,
        false,
      );
    }

    const credentials = await this.credentials.resolve(config.credentialRef, config.credentialCipher);
    if (!credentials) {
      return this.failure(0, `No credentials resolved for ${config.credentialRef}`, true);
    }

    const payload = this.buildOrder(order);
    const url = `${config.baseUrl.replace(/\/+$/, '')}/order`;

    const result = await this.post(url, payload, {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
      'X-Vendor-ID': String(config.vendorId ?? ''),
      'X-Location-ID': String(config.locationId ?? ''),
      'X-API-Network-ID': String(config.apiNetworkId ?? ''),
    }, config.timeoutMs);

    await this.recordOutcome(
      {
        orderId: order.id,
        patientId: order.prescription.patientId,
        pharmacy: order.pharmacy.name,
        tenantId: order.tenantId,
      },
      payload,
      result,
    );
    return result;
  }

  private async recordOutcome(
    order: { orderId: string; patientId: string; pharmacy: string; tenantId: string },
    payload: LifeFileOrder,
    result: LifeFileResult,
  ): Promise<void> {
    const { orderId, tenantId } = order;
    await this.prisma.raw.pharmacyOrder.update({
      where: { id: orderId },
      data: {
        attempts: { increment: 1 },
        ...(result.ok
          ? {
              status: 'SUBMITTED',
              submittedAt: new Date(),
              externalOrderId: result.orderId,
              externalRxNumber: result.rxNumber,
              lastError: null,
            }
          : {
              lastError: result.error,
              // Never downgrade a submitted order on a later failure: it did
              // land, and saying otherwise sends somebody looking for a problem
              // the pharmacy does not have.
            }),
        // The request is kept because a pharmacy disputing what it received is
        // otherwise our word against theirs. It contains PHI, which is why it
        // lives on the order rather than in a log line.
        requestPayload: payload as unknown as object,
      },
    });

    await this.audit.record({
      action: result.ok ? 'ORDER_SUBMITTED' : 'ORDER_STATUS_CHANGED',
      entityType: 'PharmacyOrder',
      entityId: orderId,
      tenantId,
      after: {
        transmitted: result.ok,
        status: result.status,
        externalOrderId: result.orderId,
        error: result.error,
      },
    });

    if (result.ok) {
      this.logger.log(`Order ${orderId} accepted by the pharmacy as ${result.orderId ?? 'unknown id'}`);
      // Published rather than messaged directly: the patient's "it is with the
      // pharmacy now" update is a subscriber's job, and a chat outage must not
      // make a transmitted order look untransmitted.
      this.events.publish(DomainEvent.OrderSubmitted, {
        orderId,
        patientId: order.patientId,
        pharmacy: order.pharmacy,
        externalOrderId: result.orderId,
      });
    } else {
      this.logger.error(`Order ${orderId} was not accepted: ${result.error}`);
    }
  }

  /** Builds the order LifeFile expects from what we hold. */
  private buildOrder(order: {
    id: string;
    pharmacy: { name: string; config: { practiceId: string | null; defaultShippingService: string | null } | null };
    prescription: {
      id: string;
      dose: string;
      quantity: string;
      refills: number;
      daysSupply: number | null;
      sig: string;
      signedAt: Date;
      licenseNumberSnapshot: string;
      licenseStateSnapshot: string;
      medication: { name: string; strength: string | null; form: string; isCompounded: boolean };
      patient: {
        firstName: string;
        lastName: string;
        dob: string;
        sexAtBirth: string | null;
        phone: string;
        email: string;
        addressLine1: string | null;
        addressLine2: string | null;
        city: string | null;
        residenceState: string | null;
        postalCode: string | null;
      };
      provider: {
        npi: string | null;
        deaNumber: string | null;
        user: { firstName: string; lastName: string; email: string; phone: string | null };
      };
    };
  }): LifeFileOrder {
    const rx = order.prescription;
    const patient = rx.patient;
    const config = order.pharmacy.config;

    // Date of birth is encrypted at rest; LifeFile needs it to identify the
    // patient in their own system, so it is decrypted here and nowhere else.
    // A record whose date of birth will not decrypt is a data problem, not a
    // reason to send an order with a blank one — the pharmacy uses it to match
    // the patient in their own system.
    const dob = this.phi.decrypt(patient.dob);

    const line: LifeFileRx = {
      rxType: 'new',
      uuid: randomUUID(),
      drugName: clip(rx.medication.name, 254),
      drugStrength: clip(rx.medication.strength ?? rx.dose, 254),
      drugForm: clip(formOf(rx.medication.form), 255),
      foreignPmsId: 0,
      foreignRxNumber: clip(rx.id, 50),
      quantity: clip(rx.quantity, 45),
      quantityUnits: 'ea',
      // The SIG, and only the SIG.
      directions: clip(rx.sig, 65535),
      refills: rx.refills,
      dateWritten: rx.signedAt.toISOString().slice(0, 10),
      daysSupply: rx.daysSupply ?? 30,
      ...(rx.medication.isCompounded
        ? {
            clinicalDifferenceStatement: clip(
              `Compounded ${rx.medication.name} as prescribed for this patient's clinical needs.`,
              65535,
            ),
          }
        : {}),
    };

    return {
      message: { id: randomUUID(), sentTime: new Date().toISOString() },
      order: {
        general: {
          memo: clip(`HealthEMR order ${order.id.slice(0, 8)}`, 120),
          referenceId: clip(order.id, 200),
        },
        prescriber: {
          npi: clip(rx.provider.npi, 20),
          licenseState: clip(rx.licenseStateSnapshot, 2),
          licenseNumber: clip(rx.licenseNumberSnapshot, 50),
          lastName: clip(rx.provider.user.lastName, 30),
          firstName: clip(rx.provider.user.firstName, 30),
          email: clip(rx.provider.user.email, 100),
          phone: phone(rx.provider.user.phone),
          ...(rx.provider.deaNumber ? { dea: rx.provider.deaNumber.toUpperCase() } : {}),
        },
        practice: { id: Number(config?.practiceId ?? 0) },
        patient: {
          lastName: clip(patient.lastName, 30),
          firstName: clip(patient.firstName, 30),
          gender: gender(patient.sexAtBirth),
          dateOfBirth: isoDate(dob),
          address1: clip(patient.addressLine1, 60),
          address2: clip(patient.addressLine2, 60),
          city: clip(patient.city, 30),
          state: clip(patient.residenceState, 2),
          zip: clip(patient.postalCode, 10),
          country: 'US',
          phoneMobile: phone(patient.phone),
          email: clip(patient.email, 100),
        },
        shipping: {
          recipientType: 'patient',
          recipientLastName: clip(patient.lastName, 30),
          recipientFirstName: clip(patient.firstName, 30),
          recipientPhone: phone(patient.phone),
          recipientEmail: clip(patient.email, 100),
          addressLine1: clip(patient.addressLine1, 60),
          addressLine2: clip(patient.addressLine2, 60),
          city: clip(patient.city, 100),
          state: clip(patient.residenceState, 2),
          zipCode: clip(patient.postalCode, 10),
          country: 'US',
          ...(config?.defaultShippingService ? { service: config.defaultShippingService } : {}),
        },
        // The clinic is billed, not the patient — the patient already paid the
        // client business, and a pharmacy charging them again is the failure
        // mode this field exists to prevent.
        billing: { payorType: 'doc' },
        rxs: [line],
      },
    };
  }

  /** POSTs with a timeout, retrying only what is worth retrying. */
  private async post(
    url: string,
    payload: LifeFileOrder,
    headers: Record<string, string>,
    timeoutMs: number,
    attempts = 3,
  ): Promise<LifeFileResult> {
    let last: LifeFileResult = this.failure(0, 'Never attempted', true);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const text = await response.text();
        const body = safeJson(text);

        if (response.ok) {
          const data = (body?.data ?? {}) as Record<string, unknown>;
          return {
            ok: true,
            status: response.status,
            orderId: firstString(data.orderId, data.id, (data.order as Record<string, unknown>)?.id),
            rxNumber: rxNumberFrom(data),
            error: null,
            retryable: false,
          };
        }

        // A 4xx means the order is wrong. Sending it again produces the same
        // rejection, and risks a duplicate if they partially accepted it.
        const retryable = response.status >= 500;
        last = this.failure(response.status, describe(body, text), retryable);
        if (!retryable) return last;
      } catch (error) {
        last = this.failure(0, explain(error, url, timeoutMs), true);
      } finally {
        clearTimeout(timer);
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }

    return last;
  }

  private failure(status: number, error: string, retryable: boolean): LifeFileResult {
    return { ok: false, status, orderId: null, rxNumber: null, error, retryable };
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function describe(body: Record<string, unknown> | null, fallback: string): string {
  const message = body?.message ?? body?.error ?? body?.raw;
  return clip(typeof message === 'string' ? message : JSON.stringify(body ?? fallback), 500);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function rxNumberFrom(data: Record<string, unknown>): string | null {
  const rxs = data.rxs;
  if (Array.isArray(rxs) && rxs.length) {
    const first = rxs[0] as Record<string, unknown>;
    return firstString(first.rxNumber, first.id);
  }
  return firstString(data.rxNumber);
}

/** LifeFile wants YYYY-MM-DD; ours is stored as MM/DD/YYYY. */
function isoDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (match) return `${match[3]}-${match[1]}-${match[2]}`;
  return value.slice(0, 10);
}

/** Our enum is a word; LifeFile expects its own dosage-form phrasing. */
function formOf(form: string): string {
  const map: Record<string, string> = {
    INJECTABLE: 'Injection, Solution',
    ORAL: 'Tablet',
    TOPICAL: 'Cream',
    NASAL: 'Spray, Nasal',
  };
  return map[form] ?? 'Injection, Solution';
}

/**
 * Says what went wrong in words somebody can act on.
 *
 * `String(error)` on a failed fetch yields "TypeError: fetch failed", which is
 * true and useless — it names the JavaScript that threw rather than the thing
 * that is broken. Whoever reads this needs to know whether to fix a URL, wait,
 * or call the pharmacy.
 */
function explain(error: unknown, url: string, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `The pharmacy system did not respond within ${Math.round(timeoutMs / 1000)}s`;
  }

  const host = safeHost(url);
  const cause = (error as { cause?: { code?: string } })?.cause?.code;

  switch (cause) {
    case 'ECONNREFUSED':
      return `Nothing is listening at ${host} — check the base URL`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `${host} could not be found — check the base URL`;
    case 'ECONNRESET':
      return `${host} closed the connection before replying`;
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `${host} presented a certificate we could not verify`;
    default:
      return `Could not reach ${host}${cause ? ` (${cause})` : ''}`;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the pharmacy system';
  }
}
