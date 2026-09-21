import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Backend-for-frontend proxy.
 *
 * Every client call goes through here so the access token is attached
 * server-side and never reaches browser JavaScript. That single property is what
 * makes an XSS bug in this app a defacement rather than a PHI breach.
 */
async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(`${API}/${path.join('/')}`);
  req.nextUrl.searchParams.forEach((value, key) => url.searchParams.set(key, value));

  const session = await auth();
  const headers: Record<string, string> = {};

  const token = (session as { accessToken?: string } | null)?.accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  let body: BodyInit | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Multipart must be forwarded as raw bytes with its original Content-Type:
    // the boundary lives in that header, and dropping it breaks the parser.
    body = contentType?.includes('multipart/form-data') ? await req.blob() : await req.text();
  }

  const response = await fetch(url.toString(), {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
  });

  const isNullBody = NULL_BODY_STATUSES.has(response.status);
  const data = isNullBody ? null : await response.arrayBuffer();

  return new NextResponse(data, {
    status: response.status,
    statusText: response.statusText,
    headers: isNullBody
      ? {}
      : { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
