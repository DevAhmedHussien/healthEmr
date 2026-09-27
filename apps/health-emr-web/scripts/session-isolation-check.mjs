/**
 * Staying signed in while another app shares the browser.
 *
 * A cookie belongs to a host, not a port, so every Next.js app on localhost
 * writes into the same jar. Auth.js names its session cookie the same way in
 * every project by default, so a second app signing in would overwrite this
 * one's session — and since the two hold different AUTH_SECRETs, what came
 * back could not be decrypted at all. The user was returned to the login page
 * at what felt like random moments and blamed the session length, which was
 * never involved.
 *
 * This writes a foreign `authjs.session-token` for localhost, exactly as the
 * neighbouring app would, and requires that this app neither notices nor cares.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', 'super@healthemr.test');
  await page.fill('input[name="password"]', 'Super!2026');
  await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

  console.log('\nThis app names its own cookie');
  const named = (await context.cookies()).map((cookie) => cookie.name);
  ok(
    'the session cookie is namespaced to this application',
    named.some((name) => name.includes('healthemr.session-token')),
    named.filter((name) => /session-token/.test(name)).join(', '),
  );
  ok(
    'and does not squat on the shared default name',
    !named.includes('authjs.session-token'),
  );

  console.log('\nA neighbouring app on localhost signs in');
  // What the other app's sign-in does to this browser: same host, same default
  // name, a value this app has no key for.
  await context.addCookies([
    {
      name: 'authjs.session-token',
      value: 'a.token.from.the.other.app.this.one.cannot.decrypt',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await page.goto(`${BASE}/super-admin/visits`);
  // Settle before evaluating — a read mid-navigation destroys the context and
  // reads as a failure when nothing is wrong. Not `networkidle`: the chat
  // socket holds a connection open, so that never arrives.
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const landed = new URL(page.url()).pathname;
  ok('we are still signed in', !landed.includes('/login'), landed);

  // Issued from the browser context rather than the page: it carries the same
  // cookie jar and cannot be torn down by a navigation mid-read.
  const session = await context.request
    .get(`${BASE}/api/auth/session`)
    .then((r) => r.json())
    .catch(() => null);
  ok('the session still resolves to the right person', session?.user?.email === 'super@healthemr.test', session?.user?.email ?? 'none');

  const data = await context.request
    .get(`${BASE}/api/bff/v1/super-admin/visits?pageSize=1`)
    .then((r) => r.status())
    .catch(() => 0);
  ok('and the API still answers', data === 200, String(data));
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
