import { NextResponse } from 'next/server';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { API_BASE_URL } from '@/lib/site';

/**
 * Where an application goes when somebody presses send.
 *
 * The site never talks to the platform from the browser. Everything goes
 * through here, server to server, for two reasons: the page carries no
 * credential that could be lifted out of it, and the shape we send to the
 * platform can change without the public form having to.
 *
 * Clinician and pharmacy applications are forwarded to the platform's public
 * onboarding endpoints, so one made here lands in exactly the same review queue
 * as one made inside the product. A telehealth enquiry has no such queue yet —
 * there is no brand-application model — so it is recorded here instead, and
 * said plainly rather than pretended otherwise.
 */

const ENDPOINTS: Record<string, string> = {
  clinician: 'v1/public/onboarding/provider',
  pharmacy: 'v1/public/onboarding/pharmacy',
};

/** Where telehealth enquiries land until the platform has an inbox for them. */
const ENQUIRY_DIR = process.env.ENQUIRY_DIR ?? join(process.cwd(), '.enquiries');

export async function POST(request: Request) {
  let body: { kind?: string; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Could not read that request.' }, { status: 400 });
  }

  const kind = String(body.kind ?? '');
  const payload = body.payload;

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ message: 'Nothing to submit.' }, { status: 400 });
  }

  // ── telehealth enquiries ────────────────────────────────────────────────
  if (kind === 'telehealth') {
    try {
      await mkdir(ENQUIRY_DIR, { recursive: true });
      await appendFile(
        join(ENQUIRY_DIR, 'telehealth.jsonl'),
        `${JSON.stringify({ receivedAt: new Date().toISOString(), ...payload })}\n`,
        'utf8',
      );
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json(
        { message: 'We could not record that. Please email us instead.' },
        { status: 500 },
      );
    }
  }

  // ── clinician and pharmacy applications ─────────────────────────────────
  const path = ENDPOINTS[kind];
  if (!path) {
    return NextResponse.json({ message: 'Unknown application type.' }, { status: 400 });
  }

  if (!API_BASE_URL) {
    return NextResponse.json(
      { message: 'Applications are not accepting submissions right now.' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${API_BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { message?: string } | null;
      // The platform's validation message is more useful than anything we could
      // invent here, so it is passed through rather than flattened to "failed".
      return NextResponse.json(
        { message: detail?.message ?? 'That did not go through. Please check the form.' },
        { status: response.status === 400 ? 400 : 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { message: 'We could not reach the application system. Please try again shortly.' },
      { status: 502 },
    );
  }
}
