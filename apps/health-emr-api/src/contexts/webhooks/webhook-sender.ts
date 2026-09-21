import { createHmac, randomBytes } from 'node:crypto';
import type { WebhookBody } from '@health-emr/types';

/** How long we wait on a client's endpoint before giving up on an attempt. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Consecutive failures before an endpoint is switched off rather than retried. */
export const WEBHOOK_FAILURE_LIMIT = 20;

/**
 * Backoff between attempts, in minutes.
 *
 * Front-loaded: most failures are a deploy or a brief outage at the far end and
 * clear within a minute. The long tail exists so an endpoint that has been down
 * all night is not hammered a thousand times before somebody looks at it.
 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];

export function nextRetryAt(attempts: number, from: Date): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
  return new Date(from.getTime() + minutes * 60_000);
}

export function newSigningSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * Proof the body came from us and was not altered on the way.
 *
 * The timestamp is inside the signed string, so a body captured off the wire
 * cannot be replayed a week later against an endpoint that checks it. The
 * scheme is deliberately the one every payment processor uses, because an
 * integrator has almost certainly written the verifying half before.
 */
export function signBody(secret: string, body: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export interface DeliveryAttempt {
  ok: boolean;
  status: number;
  responseBody: string | null;
  error: string | null;
  /** False for a 4xx: the request is wrong, and sending it again will not fix it. */
  retryable: boolean;
}

/**
 * POSTs one event to one endpoint.
 *
 * Separated from the dispatcher so the decision of *what* to send stays apart
 * from the mechanics of sending it — and so this can be tested without a
 * database.
 */
export async function postWebhook(
  url: string,
  body: WebhookBody,
  auth: { bearer: string; signingSecret: string },
): Promise<DeliveryAttempt> {
  const serialised = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Theirs, so their endpoint can refuse anyone who guessed the URL.
        authorization: `Bearer ${auth.bearer}`,
        // Ours, so they can prove it was us.
        'x-healthemr-event': body.event,
        'x-healthemr-timestamp': String(timestamp),
        'x-healthemr-signature': `sha256=${signBody(auth.signingSecret, serialised, timestamp)}`,
      },
      body: serialised,
      signal: controller.signal,
    });

    // Read it either way: a client's error text is the most useful thing we can
    // show an operator asking why their CRM is not updating. Capped, because
    // some endpoints answer an error with an entire HTML page.
    const text = (await response.text().catch(() => '')).slice(0, 2000);

    return {
      ok: response.ok,
      status: response.status,
      responseBody: text || null,
      error: response.ok ? null : `${response.status} ${text.slice(0, 200)}`.trim(),
      retryable: !response.ok && response.status >= 500,
    };
  } catch (caught) {
    const error = caught as Error;
    const timedOut = error.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      responseBody: null,
      error: timedOut ? `No answer within ${WEBHOOK_TIMEOUT_MS / 1000}s` : error.message,
      // A network failure is worth another go; a wrong URL will fail the same
      // way every time, but we cannot tell the two apart from here.
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
