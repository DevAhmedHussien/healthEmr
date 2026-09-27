/**
 * How many times the console asks the server for the same thing.
 *
 * Written after a report of "three requests per tab, one of them red". Two of
 * the three were React's development double-mount and the red one was a
 * deliberate abort — but the third was real, and returning to a tab you had
 * just left refetched it from scratch behind a skeleton.
 *
 * This pins the result: one request for a list nobody has asked for, none for
 * one already on screen, and never a cancelled request in the log.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3005';

let failures = 0;
const ok = (label, passed, detail) => {
  console.log(`  ${passed ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
};

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const calls = [];
const cancelled = [];
const listCall = (url) => url.includes('/api/bff/') && !url.includes('unread-count');
page.on('request', (r) => listCall(r.url()) && calls.push(r.url().split('/api/bff/')[1]));
page.on('requestfailed', (r) => listCall(r.url()) && cancelled.push(r.url().split('/api/bff/')[1]));

await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes('login')),
  page.click('button[type="submit"]'),
]);
// Wait for the shell, not a stopwatch. Under load a dev compile can outlast any
// fixed delay, and clicking a nav link that has not rendered yet measured zero
// requests and failed on correct behaviour.
await page.waitForSelector('nav a', { timeout: 30000 });
await page.waitForLoadState('networkidle');

const click = async (tab) => {
  calls.length = 0;
  cancelled.length = 0;

  const link = page.locator(`nav a:has-text("${tab}")`).first();
  const href = await link.getAttribute('href');

  await link.click();
  // Confirm we actually arrived before counting: a click that did not navigate
  // would otherwise read as a perfect cache hit.
  await page.waitForURL((url) => url.pathname === href, { timeout: 20000 });
  await page.waitForTimeout(2600);

  return { made: [...calls], aborted: [...cancelled] };
};

console.log('First visit to a tab');
for (const tab of ['Visits', 'Patients', 'Prescriptions']) {
  const { made, aborted } = await click(tab);
  ok(`${tab} asks once`, made.length === 1, `${made.length} requests`);
  ok(`${tab} cancels nothing`, aborted.length === 0, aborted.join(', '));
}

console.log('\nGoing back to a tab');

/**
 * Tight, and timed.
 *
 * The cache holds an answer for thirty seconds and revalidates after that, so a
 * long click-path legitimately refetches — in development the first visit to a
 * route also waits on a compile, which was enough to push an earlier version of
 * this check past the window and fail on correct behaviour. So the round trip
 * is two clicks, and the assertion only applies if it actually finished inside
 * the window.
 */
const started = Date.now();
await click('Patients');
const again = await click('Visits');
const elapsed = Date.now() - started;

if (elapsed < 25_000) {
  ok(
    'a list already on screen is not refetched',
    again.made.length === 0,
    `${again.made.length} requests after ${Math.round(elapsed / 1000)}s`,
  );
} else {
  console.log(`  – took ${Math.round(elapsed / 1000)}s, past the freshness window; not asserted`);
}

// This holds either way: revalidating in the background must not blank the
// table, which is the whole point of showing the cached rows first.
const skeleton = await page.locator('.ar-skeleton').count();
ok('and it does not flash a skeleton', skeleton === 0, `${skeleton} skeleton rows`);

console.log('\nChanging the query');
calls.length = 0;
await page.locator('th').filter({ hasText: /Submitted/i }).first().click();
await page.waitForTimeout(2200);
ok('a different sort does ask again', calls.length > 0, `${calls.length} requests`);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
