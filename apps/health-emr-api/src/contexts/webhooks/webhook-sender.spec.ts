import { createHmac } from 'node:crypto';
import { nextRetryAt, newSigningSecret, postWebhook, signBody } from './webhook-sender';

/**
 * The half of the integration a client writes code against.
 *
 * A signature they cannot verify, or a retry schedule that hammers them, is
 * their problem to live with and ours to get right — so both are pinned here.
 */
describe('webhook delivery', () => {
  const body = {
    masterId: 'M-1',
    event: 'CONSULT_RECEIVED',
    occurredAt: '2026-09-21T00:00:00.000Z',
  } as const;

  afterEach(() => jest.restoreAllMocks());

  it('signs the timestamp with the body, so a captured request cannot be replayed', () => {
    const signature = signBody('whsec_test', '{"a":1}', 1_700_000_000);

    // The scheme every payment processor uses, because an integrator has
    // almost certainly written the verifying half before.
    expect(signature).toBe(
      createHmac('sha256', 'whsec_test').update('1700000000.{"a":1}').digest('hex'),
    );
    // Same body, different minute — a different signature.
    expect(signBody('whsec_test', '{"a":1}', 1_700_000_060)).not.toBe(signature);
  });

  it('presents the client their own token and a signature over what was sent', async () => {
    let seen: { headers: Record<string, string>; body: string } | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url: unknown, init?: unknown) => {
      const request = init as { headers: Record<string, string>; body: string };
      seen = { headers: request.headers, body: request.body };
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const result = await postWebhook('https://crm.test/hook', body, {
      bearer: 'their-token',
      signingSecret: 'whsec_test',
    });

    expect(result.ok).toBe(true);
    expect(seen?.headers.authorization).toBe('Bearer their-token');
    expect(seen?.headers['x-healthemr-event']).toBe('CONSULT_RECEIVED');

    // The signature has to verify against the body exactly as it went, not
    // against a re-serialisation of it.
    const timestamp = Number(seen!.headers['x-healthemr-timestamp']);
    expect(seen?.headers['x-healthemr-signature']).toBe(
      `sha256=${signBody('whsec_test', seen!.body, timestamp)}`,
    );
  });

  it('retries a server error and gives up on a rejected request', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }));
    await expect(
      postWebhook('https://crm.test/hook', body, { bearer: 't', signingSecret: 's' }),
    ).resolves.toMatchObject({ ok: false, status: 503, retryable: true });

    // A 400 means the request is wrong. Sending it again will not fix it, and
    // doing so all night is how an integration becomes a nuisance.
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(
      postWebhook('https://crm.test/hook', body, { bearer: 't', signingSecret: 's' }),
    ).resolves.toMatchObject({ ok: false, status: 400, retryable: false });
  });

  it('treats an unreachable endpoint as worth another go', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      postWebhook('https://crm.test/hook', body, { bearer: 't', signingSecret: 's' }),
    ).resolves.toMatchObject({ ok: false, status: 0, retryable: true });
  });

  it('keeps their error text, which is what an operator needs to read', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('invalid masterId format', { status: 422 }));

    const result = await postWebhook('https://crm.test/hook', body, {
      bearer: 't',
      signingSecret: 's',
    });
    expect(result.error).toContain('invalid masterId format');
  });

  it('backs off further each time, and stops widening', () => {
    const start = new Date('2026-09-21T00:00:00.000Z');
    const minutes = (attempt: number) =>
      (nextRetryAt(attempt, start).getTime() - start.getTime()) / 60_000;

    expect(minutes(0)).toBe(1);
    expect(minutes(1)).toBe(5);
    expect(minutes(3)).toBe(60);
    // Past the end of the table it holds, rather than growing without bound.
    expect(minutes(20)).toBe(minutes(5));
  });

  it('mints a secret that is recognisable and not guessable', () => {
    const secret = newSigningSecret();
    expect(secret).toMatch(/^whsec_/);
    expect(secret.length).toBeGreaterThan(30);
    expect(newSigningSecret()).not.toBe(secret);
  });
});
