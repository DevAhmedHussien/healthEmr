/**
 * What the operator sees between pressing "Sign in" and having a console.
 *
 * The complaint this exists to stop regressing: a white page for a second or
 * two, then components appearing one at a time. A blank page reads as a broken
 * application; a shaped placeholder reads as a loading one.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome' });

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Throttled, so the loading state is observable rather than a single frame.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300,
    downloadThroughput: (750 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', 'super@healthemr.test');
  await page.fill('input[name="password"]', 'Super!2026');

  console.log('\nBetween sign-in and the console');
  const samples = [];
  const watcher = setInterval(async () => {
    samples.push(
      await page
        .evaluate(() => ({
          blank: document.body.innerText.trim().length === 0,
          skeletons: document.querySelectorAll('.ar-skeleton').length,
        }))
        .catch(() => null),
    );
  }, 120);

  await page.click('button[type="submit"]');
  await page.waitForURL(/super-admin/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  clearInterval(watcher);

  const seen = samples.filter(Boolean);
  const blankFrames = seen.filter((s) => s.blank).length;
  const skeletonFrames = seen.filter((s) => s.skeletons > 0).length;

  ok('the page is never blank while it loads', blankFrames === 0, `${blankFrames} of ${seen.length} frames blank`);
  ok('a placeholder stands in for the content', skeletonFrames > 0, `${skeletonFrames} frames with skeletons`);

  console.log('\nOnce it has arrived');
  ok('the overview is on screen', (await page.locator('h1, h2').first().isVisible()));
  ok('and the placeholders are gone', (await page.locator('.ar-skeleton').count()) === 0);

  // Throttling served its purpose; the rest of the checks are about behaviour,
  // not timing, and a dev-mode page compile on a 750kbps pipe simply times out.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  console.log('\nRefreshing a table');
  await page.goto(`${BASE}/super-admin/visits`);
  await page.waitForSelector('table tbody tr');
  await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});

  const refresh = page.getByRole('button', { name: /^Refresh/ });
  ok('every table offers a refresh', (await refresh.count()) > 0);

  let refetched = false;
  page.on('request', (request) => {
    if (request.url().includes('/api/bff/v1/super-admin/visits')) refetched = true;
  });
  await refresh.first().click();
  await page.waitForTimeout(2500);
  ok('pressing it asks the server again', refetched);
  ok('and the rows are still there afterwards', (await page.locator('table tbody tr').count()) > 1);

  await context.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
