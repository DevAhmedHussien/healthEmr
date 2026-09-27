import { NextRequest, NextResponse } from 'next/server';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * The hosted intake form's way in.
 *
 * A patient's browser cannot hold a tenant API key — anything it holds is
 * readable by anyone who opens the page. So the form posts here, and this route
 * attaches the key server-side, exactly as the BFF does for a signed-in session.
 *
 * The key is resolved per tenant from the environment as
 * `HOSTED_INTAKE_KEY_<SLUG>`, upper-cased with non-alphanumerics replaced by
 * underscores. A client business that has not been given a hosted form has no
 * key configured and this route refuses, rather than falling back to somebody
 * else's.
 *
 * This is deliberately the only unauthenticated write path in the app, and the
 * API rate-limits intake per IP behind it.
 */
function keyFor(tenant: string): string | undefined {
  return process.env[`HOSTED_INTAKE_KEY_${tenant.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const key = keyFor(tenant);

  if (!key) {
    return NextResponse.json({ error: 'This form is not accepting submissions.' }, { status: 404 });
  }

  const payload = (await req.json()) as { path?: string; body?: unknown };
  // Only the two calls a form legitimately makes. Without this the route is an
  // open proxy onto the partner API with a key attached.
  const allowed = /^(visits|visits\/[A-Za-z0-9-]+\/uploads)$/;
  const path = String(payload.path ?? '');
  if (!allowed.test(path)) {
    return NextResponse.json({ error: 'Not a permitted call.' }, { status: 400 });
  }

  const response = await fetch(`${API}/partner/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload.body ?? {}),
    cache: 'no-store',
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

/** The questionnaire and the pharmacy's kits, so the form knows what to render. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const key = keyFor(tenant);
  if (!key) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });

  const path = req.nextUrl.searchParams.get('path') ?? '';
  const allowed = /^(intake-forms\/[A-Za-z]+|pharmacies|pharmacies\/[a-z0-9-]+\/catalog)$/;
  if (!allowed.test(path)) {
    return NextResponse.json({ error: 'Not a permitted call.' }, { status: 400 });
  }

  const response = await fetch(`${API}/partner/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}
