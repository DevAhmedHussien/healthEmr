/** First visit to each route — the on-demand compile a developer waits through. */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

const ROUTES = [
  '/super-admin/visits',
  '/super-admin/prescriptions',
  '/super-admin/providers',
  '/super-admin/patients',
  '/super-admin/activity',
  '/super-admin/pharmacies',
  '/super-admin/medications',
  '/super-admin/invoices',
];

let total = 0;
console.log(`\n${BASE} — first visit to each route\n`);
for (const path of ROUTES) {
  const t0 = Date.now();
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  const ms = Date.now() - t0;
  total += ms;
  console.log(`  ${path.padEnd(34)} ${String(ms).padStart(6)}ms`);
}
console.log(`\n  ${String(total).padStart(6)}ms total, ${Math.round(total / ROUTES.length)}ms average`);

await browser.close();
