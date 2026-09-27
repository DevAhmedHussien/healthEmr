import { z } from 'zod';

/**
 * What a client business's own systems are told, as it happens.
 *
 * The platform already narrates a visit to the patient in their chat thread —
 * received, decided, prescribed, sent, shipped. These are the same moments,
 * posted to the client instead of only into a conversation, so their CRM can
 * show a patient and a salesperson where a visit has got to without anybody
 * polling us for it.
 *
 * The vocabulary follows the incumbent's so an integration written against
 * Beluga keeps working, with two deliberate departures noted below.
 */
export const WEBHOOK_EVENTS = [
  /**
   * A clinician has read the chart and decided.
   *
   * Raised alongside `RX_WRITTEN` when something was prescribed. The two can
   * arrive in either order — build a timeline from `occurredAt`, not from the
   * order they turn up.
   */
  'CONSULT_CONCLUDED',
  /** A prescription was written and signed. */
  'RX_WRITTEN',
  /** The visit was cancelled — by the client, or withdrawn by the platform. */
  'CONSULT_CANCELED',
  /** The pharmacy has the order and is filling it. */
  'PHARMACY_ORDER_IN_FULFILLMENT',
  /** It has left the pharmacy. Carries the carrier and tracking number. */
  'PHARMACY_ORDER_SHIPPED',
  /** The carrier says it arrived. */
  'PHARMACY_ORDER_DELIVERED',
  /** A patient's name was corrected here and should be corrected there too. */
  'NAME_UPDATE',
  /** The clinician wrote to the patient. Content included so a CRM can show the thread. */
  'DOCTOR_CHAT',
  /**
   * Where the parcel is, as the carrier reports it.
   *
   * Separate from PHARMACY_ORDER_SHIPPED, which says the pharmacy handed it
   * over. These say what happened to it afterwards, and a support desk fielding
   * "where is my package" needs the second kind, not the first.
   */
  'PACKAGE_IN_TRANSIT',
  'PACKAGE_OUT_FOR_DELIVERY',
  'PACKAGE_DELIVERED',
  'PACKAGE_DELIVERY_FAILED',
  /**
   * The visit reached us and is queued for a clinician.
   *
   * Not in the incumbent's list. Added because a CRM that only hears about
   * outcomes cannot tell "submitted and waiting" from "never arrived", which is
   * the first question a salesperson is asked.
   */
  'CONSULT_RECEIVED',
  /**
   * The clinician has asked the patient something and is waiting on the answer.
   *
   * A real state the visit sits in, sometimes for days, and the only one that
   * the patient rather than the platform can end. Without it a client's console
   * shows "in review" while the visit is in fact parked, and their support desk
   * chases us about a delay the patient could clear in a sentence.
   *
   * The question itself arrives separately as DOCTOR_CHAT. This carries no
   * clinical content — it is the status, not the conversation.
   */
  'CONSULT_INFO_REQUESTED',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  CONSULT_RECEIVED: 'Visit received',
  CONSULT_CONCLUDED: 'Visit decided',
  RX_WRITTEN: 'Prescription written',
  CONSULT_CANCELED: 'Visit cancelled',
  PHARMACY_ORDER_IN_FULFILLMENT: 'Pharmacy is filling it',
  PHARMACY_ORDER_SHIPPED: 'Shipped',
  PHARMACY_ORDER_DELIVERED: 'Delivered',
  NAME_UPDATE: 'Patient name corrected',
  DOCTOR_CHAT: 'Clinician messaged the patient',
  PACKAGE_IN_TRANSIT: 'Parcel in transit',
  PACKAGE_OUT_FOR_DELIVERY: 'Parcel out for delivery',
  PACKAGE_DELIVERED: 'Parcel delivered',
  PACKAGE_DELIVERY_FAILED: 'Parcel could not be delivered',
  CONSULT_INFO_REQUESTED: 'Clinician asked the patient a question',
};

/**
 * Every body carries the client's own `masterId`, because that is the only
 * identifier they gave us and therefore the only one their CRM can join on.
 */
const base = z.object({
  masterId: z.string(),
  event: z.enum(WEBHOOK_EVENTS),
  /** When the thing happened here, not when we managed to deliver it. */
  occurredAt: z.string(),
});

export const webhookBodySchema = z.discriminatedUnion('event', [
  base.extend({ event: z.literal('CONSULT_RECEIVED') }),

  /**
   * No fields of its own. The question the clinician asked travels as
   * DOCTOR_CHAT; this says only that the visit is now waiting on the patient,
   * and a status that carried clinical detail would be a disclosure nobody
   * asked for when they enabled it.
   */
  base.extend({ event: z.literal('CONSULT_INFO_REQUESTED') }),

  base.extend({
    event: z.literal('CONSULT_CONCLUDED'),
    /**
     * `refused` is ours. The incumbent reported only `prescribed` or
     * `referred`, which left a clinician declining to treat looking identical
     * to one sending the patient elsewhere — a difference a CRM has to show.
     */
    visitOutcome: z.enum(['prescribed', 'referred', 'refused']),
    /** Present when the clinician gave one. */
    reason: z.string().optional(),
  }),

  base.extend({
    event: z.literal('RX_WRITTEN'),
    docName: z.string(),
    docNpi: z.string().nullable(),
    medsPrescribed: z.array(
      z.object({
        name: z.string(),
        strength: z.string(),
        refills: z.string(),
        quantity: z.string(),
        /** The platform id the client ordered by — not the pharmacy's kit code. */
        medId: z.string(),
        rxId: z.string(),
        sig: z.string(),
        daysSupply: z.string(),
      }),
    ),
  }),

  base.extend({
    event: z.literal('CONSULT_CANCELED'),
    reason: z.string().optional(),
  }),

  base.extend({
    event: z.literal('PHARMACY_ORDER_IN_FULFILLMENT'),
    orderId: z.string(),
  }),

  base.extend({
    event: z.literal('PHARMACY_ORDER_SHIPPED'),
    orderId: z.string(),
    info: z.object({ carrier: z.string().nullable(), tracking: z.string().nullable() }),
  }),

  base.extend({
    event: z.literal('PHARMACY_ORDER_DELIVERED'),
    orderId: z.string(),
  }),

  base.extend({
    event: z.literal('NAME_UPDATE'),
    firstName: z.string().max(100),
    lastName: z.string().max(100),
  }),

  base.extend({
    event: z.literal('DOCTOR_CHAT'),
    content: z.string(),
  }),

  /**
   * Carrier tracking.
   *
   * Four fields of `info` are nullable and usually null, and that is deliberate
   * rather than unfinished: `trackerStatus`, `trackerId` and `trackingUrl` come
   * from a carrier-tracking provider this platform is not connected to. Sending
   * null says "we do not know"; inventing a tracking URL would send a support
   * desk to a page that does not exist.
   */
  base.extend({
    event: z.enum([
      'PACKAGE_IN_TRANSIT',
      'PACKAGE_OUT_FOR_DELIVERY',
      'PACKAGE_DELIVERED',
      'PACKAGE_DELIVERY_FAILED',
    ]),
    orderId: z.string(),
    info: z.object({
      trackerStatus: z.string().nullable(),
      trackerId: z.string().nullable(),
      trackingUrl: z.string().nullable(),
      tracking: z.string().nullable(),
      carrier: z.string().nullable(),
      deliveredDate: z.string().nullable(),
    }),
  }),
]);

export type WebhookBody = z.infer<typeof webhookBodySchema>;

/**
 * Plain http is refused, because these bodies carry patient information and an
 * unencrypted hop would disclose it to anything between us and them.
 *
 * Loopback is the one exception. An integrator building against us runs their
 * endpoint on their own machine first, and refusing that would push them to
 * test against a real client's URL — which is worse than the thing the rule
 * exists to prevent.
 */
function isDeliverable(value: string): boolean {
  if (value.startsWith('https://')) return true;

  try {
    const { protocol, hostname } = new URL(value);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Registering an endpoint. Super Admin only — see the controller. */
export const createWebhookSchema = z.object({
  name: z.string().trim().min(2, 'Give this endpoint a name').max(120),
  url: z
    .string()
    .trim()
    .url('Enter the full URL, including https://')
    .max(500)
    .refine(isDeliverable, {
      message: 'Must be https — these bodies carry patient information',
    }),
  /**
   * The bearer token the client's endpoint expects from us. Theirs, not ours:
   * it is how their system knows the request is from us and not from anyone
   * who guessed the URL.
   */
  authToken: z.string().trim().min(8, 'Too short to be a credential').max(500),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1, 'Choose at least one event to send')
    .max(WEBHOOK_EVENTS.length),
  isActive: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = createWebhookSchema
  .partial()
  /** Omitted rather than blanked: sending no token leaves the stored one alone. */
  .extend({ authToken: z.string().trim().min(8).max(500).optional() });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
