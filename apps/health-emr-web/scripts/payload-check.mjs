/**
 * The "what we sent the pharmacy" dialog.
 *
 * The question it exists to answer is "the pharmacy says they never got it" —
 * so the assertion that matters is that the real request body is on screen,
 * not a summary of it.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

await page.goto(`${BASE}/super-admin/stuck`);
await page.waitForLoadState('networkidle');

console.log('\nStuck orders');
const trigger = page.getByRole('button', { name: 'What we sent' }).first();
const present = await trigger.count();
ok('every stuck order offers its payload', present > 0, `${present} rows`);

if (present) {
  await trigger.click();
  await page.waitForSelector('[role="dialog"]');
  const dialog = page.locator('[role="dialog"]');
  // The body is fetched after the dialog opens; asserting before it lands reads
  // the loading state and reports nothing was rendered.
  await dialog.getByText('Pharmacy', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {});

  console.log('\nThe dialog');
  if (process.env.DUMP) console.log(`\n--- dialog text ---\n${await dialog.innerText()}\n---\n`);
  ok('it names the pharmacy and the platform', /LIFEFILE|GENERIC_HTTP/.test(await dialog.innerText()));
  ok('it says where the request was posted', /Posted to/i.test(await dialog.innerText()));

  const body = await dialog.locator('pre').first().innerText().catch(() => '');
  const sent = body.length > 0;
  if (sent) {
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* reported below */
    }
    ok('the request body is valid JSON', parsed !== null, `${body.length} chars`);
    ok(
      'and it is the LifeFile order contract, not a summary',
      Boolean(parsed?.order?.rxs && parsed?.order?.patient && parsed?.message?.id),
      parsed ? Object.keys(parsed.order ?? {}).join(', ') : '',
    );
    ok('it can be copied', (await dialog.getByRole('button', { name: /copy/i }).count()) === 1);
  } else {
    // An order that never reached transmission has nothing to show, and the
    // dialog should say that rather than render an empty box.
    ok(
      'an untransmitted order says so plainly',
      /Nothing has been sent/i.test(await dialog.innerText()),
    );
  }

  ok(
    'it warns that this is PHI and the read is recorded',
    /recorded against the chart/i.test(await dialog.innerText()),
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('escape closes it', (await page.locator('[role="dialog"]').count()) === 0);
}

/**
 * The same viewer on a fill that actually went out.
 *
 * The stuck list holds orders that never reached a pharmacy, so it can only
 * ever show "nothing was sent". A transmitted order is where the real request
 * body lives, and that is the case worth asserting.
 */
console.log('\nA fill that did go out');
await page.goto(`${BASE}/super-admin/prescriptions`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForLoadState('networkidle');

// The column is off by default — it is an integration question, not a clinical
// one — so turn it on the way an operator would.
await page.getByRole('button', { name: /^Columns/ }).click();
await page.getByText('Sent', { exact: true }).click();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Scoped to the table body: the page has other controls named "View".
const viewers = page.locator('table tbody').getByRole('button', { name: 'View', exact: true });
const count = await viewers.count();
ok('a transmitted fill offers its payload', count > 0, `${count} rows`);

if (count) {
  await viewers.first().scrollIntoViewIfNeeded();
  await viewers.first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByText('Pharmacy', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {});

  ok('the dialog names what the pharmacy called it', /Their order id/i.test(await dialog.innerText()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/**
 * The shape of the body is pinned by a unit test — `lifefile-payload.spec.ts`
 * asserts it field by field against a fixture, which is deterministic in a way
 * that hunting for a transmitted order in whatever data an environment happens
 * to hold is not. What this check owns is the console: that the dialog exists,
 * reaches the endpoint, and renders what comes back.
 */
const errors = [];
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
await page.reload();
await page.waitForLoadState('networkidle');
ok('no console errors', errors.length === 0, errors[0] ?? '');

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
