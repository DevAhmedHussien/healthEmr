/**
 * Every role, against every route group it does not own.
 *
 * check-links.mjs proves the links a role is given all work. This proves the
 * opposite and more important half: that the routes they are *not* given cannot
 * be reached by typing the address. In an EMR a wrong chart rendered for 200ms
 * is an incident, so "redirected" is the only acceptable answer — not a 403
 * page drawn after the data arrived.
 *
 * It then asks the API the same questions directly, because the middleware is
 * user experience and the API is the actual boundary. If only one of the two
 * refuses, the application is one bug away from exposure.
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:3005';
const API = 'http://localhost:4000';

const ACCOUNTS = [
  ['SUPER_ADMIN', 'super@healthemr.test', 'Super!2026', '/super-admin'],
  ['ADMIN', 'admin@joeymed.test', 'Admin!2026', '/admin'],
  ['PROVIDER', 'dr.reyes@healthemr.test', 'Provider!2026', '/clinic'],
  ['PHARMACY', 'rx@firstchoice.test', 'Pharmacy!2026', '/dispensary'],
  ['PATIENT', 'marta.6769320@example.test', 'Patient!2026', '/portal'],
];

const GROUPS = ['/super-admin', '/admin', '/clinic', '/dispensary', '/portal'];

/** One endpoint per role, each one the role that owns it reaches every day. */
const ENDPOINTS = [
  ['SUPER_ADMIN', 'v1/super-admin/visits'],
  ['ADMIN', 'v1/admin/visits'],
  ['PROVIDER', 'v1/clinic/queue'],
  ['PHARMACY', 'v1/dispensary/orders'],
  ['PATIENT', 'v1/portal/visits'],
];

let failures = 0;
const ok = (what, passed, detail = '') => {
  if (!passed) failures += 1;
  console.log(`  ${passed ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' });

console.log('Signed out, a guarded route asks you to sign in');
{
  const page = await (await browser.newContext()).newPage();
  for (const group of GROUPS) {
    await page.goto(`${WEB}${group}`);
    const url = new URL(page.url());
    ok(
      `${group} sends you to the login page`,
      url.pathname === '/login' && url.searchParams.get('next') === group,
      url.pathname + url.search,
    );
  }
  await page.close();
}

for (const [role, email, password, home] of ACCOUNTS) {
  console.log(`\nSigned in as ${role}`);
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${WEB}/login`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  ok(`lands on ${home}`, page.url().includes(home), new URL(page.url()).pathname);

  // The login page is not somewhere a signed-in person should be able to sit.
  await page.goto(`${WEB}/login`);
  ok('cannot go back to the login page', !page.url().includes('/login'), new URL(page.url()).pathname);

  for (const group of GROUPS.filter((candidate) => candidate !== home)) {
    await page.goto(`${WEB}${group}`);
    const landed = new URL(page.url()).pathname;
    // Not merely "not that group" — it has to be this role's own home, and the
    // address bar has to say so, or a bookmark would keep re-entering it.
    ok(`${group} is refused`, landed.startsWith(home), landed);

    // And nothing from the other group was painted on the way.
    const leaked = await page.evaluate(
      (prefix) => document.body.innerHTML.includes(`href="${prefix}/`),
      group,
    );
    ok(`${group} left nothing on screen`, !leaked);
  }

  // The API, asked directly, with this role's real token.
  const token = await page.evaluate(async () => {
    const response = await fetch('/api/bff/v1/auth/me');
    return response.ok;
  });
  ok('the API knows who this is', token);

  for (const [owner, path] of ENDPOINTS) {
    const status = await page.evaluate(async (target) => {
      const response = await fetch(`/api/bff/${target}`);
      return response.status;
    }, path);
    if (owner === role) {
      ok(`API ${path} answers its own role`, status === 200, String(status));
    } else {
      ok(`API ${path} refuses ${role}`, status === 401 || status === 403, String(status));
    }
  }

  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
