/** What a single cold navigation actually spends its time on. */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const PATH = process.env.PATH_UNDER_TEST ?? '/super-admin/visits';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);
await page.goto(`${BASE}${PATH}`);
await page.waitForLoadState('networkidle');

const requests = [];
page.on('requestfinished', async (request) => {
  const timing = request.timing();
  if (timing.responseEnd < 0) return;
  requests.push({
    url: new URL(request.url()).pathname,
    type: request.resourceType(),
    start: timing.startTime,
    ms: Math.round(timing.responseEnd),
  });
});

const t0 = Date.now();
await page.goto(`${BASE}${PATH}`, { waitUntil: 'domcontentloaded' });
const dom = Date.now() - t0;
await page.waitForLoadState('networkidle');
const total = Date.now() - t0;

const nav = await page.evaluate(() => {
  const [entry] = performance.getEntriesByType('navigation');
  const paints = performance.getEntriesByType('paint');
  return {
    ttfb: Math.round(entry.responseStart),
    documentDone: Math.round(entry.responseEnd),
    domInteractive: Math.round(entry.domInteractive),
    domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
    loadEvent: Math.round(entry.loadEventEnd),
    firstPaint: Math.round(paints.find((p) => p.name === 'first-paint')?.startTime ?? 0),
    firstContentful: Math.round(paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0),
    transfer: Math.round(entry.transferSize / 1024),
  };
});

console.log(`\n${BASE}${PATH}\n`);
for (const [k, v] of Object.entries(nav)) console.log(`  ${k.padEnd(20)} ${v}${k === 'transfer' ? 'kb' : 'ms'}`);
console.log(`  ${'domcontentloaded'.padEnd(20)} ${dom}ms\n  ${'networkidle'.padEnd(20)} ${total}ms`);

const counts = new Map();
for (const r of requests) {
  const key = `${r.type}|${r.url}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log('\n  requests after the document (× = repeated):');
for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  const [type, url] = key.split('|');
  console.log(`    ${n > 1 ? `${n}×` : '  '}  ${type.padEnd(8)} ${url.slice(0, 74)}`);
}
console.log(`\n  ${requests.length} requests total, ${counts.size} distinct`);

await browser.close();
