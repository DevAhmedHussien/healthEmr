/**
 * The chat, as a clinician holding several conversations uses it.
 *
 * Two things this exists to stop regressing: a list where every row reads the
 * same, and an upload that fails with a 500 because the request was typed as
 * JSON over the top of its own multipart boundary.
 */
import { chromium } from 'playwright';
import { Buffer } from 'node:buffer';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', 'dr.okafor@healthemr.test');
  await page.fill('input[name="password"]', 'Provider!2026');
  await Promise.all([page.waitForURL(/clinic/), page.click('button[type="submit"]')]);

  await page.goto(`${BASE}/clinic/messages`);
  await page.waitForLoadState('networkidle');

  console.log('\nThe conversation list');
  const rows = page.locator('ul li button');
  const count = await rows.count();
  ok('there are conversations', count > 0, `${count}`);

  if (count) {
    const labels = [];
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      labels.push((await rows.nth(i).locator('span').first().innerText()).trim());
    }
    ok(
      'each names who it is with, rather than all reading the same',
      new Set(labels).size > 1 || !/care team/i.test(labels[0] ?? ''),
      labels.join(' | '),
    );

    // A long name is cut off visually, so the full one has to be reachable.
    const titled = await rows.nth(0).locator('span[title]').count();
    ok('a truncated name carries the full one as a tooltip', titled > 0);

    await rows.first().click();
    await page.waitForLoadState('networkidle');
    ok(
      'the open conversation names who you are writing to',
      (await page.locator('.ar-card').nth(1).innerText()).length > 0,
    );
  }

  console.log('\nSending a photograph');
  const failed = [];
  page.on('response', (response) => {
    if (response.url().includes('/attachments') && response.status() >= 400) {
      failed.push(`${response.status()} ${response.url().split('/api/bff/')[1]}`);
    }
  });

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'injection-site.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.waitForTimeout(2500);

  ok('the upload is accepted', failed.length === 0, failed[0] ?? '');
  ok(
    'and it appears in the thread',
    (await page.locator('img[alt="injection-site.png"]').count()) > 0 ||
      /photograph/i.test(await page.locator('body').innerText()),
  );

  /**
   * The docked conversation.
   *
   * It exists so a reply does not require leaving the chart — so the assertion
   * that matters is that it is reachable from a page that is not Messages.
   */
  console.log('\nThe dock, from a visit');
  await page.goto(`${BASE}/clinic`);
  await page.waitForSelector('table tbody a[href^="/clinic/visits/"]');
  await page.locator('table tbody a[href^="/clinic/visits/"]').first().click();
  await page.waitForURL('**/clinic/visits/*');
  await page.waitForLoadState('networkidle');

  const launcher = page.getByRole('button', { name: /^Messages/ });
  ok('it is reachable without leaving the chart', (await launcher.count()) > 0);

  await launcher.first().click();
  const dock = page.locator('section[aria-label="Messages"]');
  await dock.waitFor({ timeout: 10000 });
  ok('it opens over the page', await dock.isVisible());

  const first = dock.locator('ul li button').first();
  ok('and lists conversations by name', (await first.count()) > 0);
  if (await first.count()) {
    const name = (await first.locator('span').first().innerText()).trim();
    ok('with a real name on it', name.length > 0 && !/care team/i.test(name), name);

    await first.click();
    await page.waitForTimeout(1200);
    ok('opening one shows a reply box', (await dock.getByLabel('Write a reply').count()) > 0);
    ok('and names who you are writing to', (await dock.locator('header').innerText()).trim().length > 0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Escape steps back rather than closing: somebody deep in a thread means
    // to leave the thread, not the dock.
    ok('escape steps back to the list', (await dock.locator('ul li button').count()) > 0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok('and again closes it', (await page.locator('section[aria-label="Messages"]').count()) === 0);
  }

  console.log('\nWhere it stays out of the way');
  // A signed-in visit to /login is redirected to the console, so this needs a
  // session that has never authenticated.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`${BASE}/login`);
  await guestPage.waitForLoadState('networkidle');
  ok(
    'it is absent from sign-in',
    (await guestPage.getByRole('button', { name: /^Messages/ }).count()) === 0,
    guestPage.url(),
  );
  await guest.close();

  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(`${BASE}/clinic`);
  await page.waitForLoadState('networkidle');
  ok('no console errors', errors.length === 0, errors[0] ?? '');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
