/**
 * How long the console takes to respond, measured the way it is used.
 *
 * Two numbers per route. A hard reload is the worst case — the browser fetches
 * the document, the JS, then the data. An in-app click is the common case, and
 * the one a user reads as "the app is slow" when it lags.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

const ROUTES = [
  '/super-admin',
  '/super-admin/visits',
  '/super-admin/prescriptions',
  '/super-admin/providers',
  '/super-admin/patients',
  '/super-admin/revenue',
  '/super-admin/activity',
  '/super-admin/pharmacies',
  '/super-admin/admins',
];

const settle = () => page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

// Warm every route so on-demand compilation is not counted as navigation cost.
for (const path of ROUTES) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await settle();
}

const median = (runs) => runs.sort((a, b) => a - b)[Math.floor(runs.length / 2)];

console.log(`\n${BASE} — warmed\n`);
console.log('route'.padEnd(32) + 'reload'.padStart(10) + 'in-app click'.padStart(15));

for (const path of ROUTES) {
  const reloads = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await settle();
    reloads.push(Date.now() - t0);
  }

  // Back to the dashboard, then click through as a user would.
  const clicks = [];
  const link = page.locator(`a[href="${path}"]`).first();
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/super-admin`, { waitUntil: 'domcontentloaded' });
    await settle();
    if (!(await link.count())) break;
    const t0 = Date.now();
    await link.click();
    await page.waitForURL(`**${path}`, { timeout: 20000 }).catch(() => {});
    await settle();
    clicks.push(Date.now() - t0);
  }

  const click = clicks.length ? `${median(clicks)}ms` : 'no nav link';
  console.log(path.padEnd(32) + `${median(reloads)}ms`.padStart(10) + click.padStart(15));
}

await browser.close();
