/**
 * One outbound channel.
 *
 * `carriesPhi` is the important field. Email and SMS traverse networks and land
 * on devices we do not control, so by default they carry a nudge and a link and
 * nothing else — never a medication name, a condition, or a tracking number that
 * can be tied to a treatment. In-app content sits behind authentication; the
 * tenant webhook goes to a business associate under contract. Those two may
 * carry detail.
 */
export interface NotificationChannelAdapter {
  readonly channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WEBHOOK';
  /** Whether this channel is permitted to carry PHI without explicit consent. */
  readonly carriesPhi: boolean;
  readonly enabled: boolean;

  send(message: OutboundMessage): Promise<DeliveryResult>;
}

export interface OutboundMessage {
  target: string;
  subject: string;
  body: string;
  /** Deep link into the portal, where the real content lives. */
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}
