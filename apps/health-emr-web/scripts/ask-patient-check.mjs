/**
 * A clinician asking the patient something before deciding.
 *
 * The assertion that matters most is the one about the nudge: the patient is
 * told their clinician has a question and nothing else, because that message
 * arrives on a lock screen anybody nearby can read.
 */
import { chromium } from 'playwright';

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

  await page.waitForSelector('table tbody tr');
  await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});

  // The queue links to each visit rather than making the whole row a target.
  await page.locator('table tbody a[href^="/clinic/visits/"]').first().click();
  await page.waitForURL('**/clinic/visits/*', { timeout: 15000 });
  const visitId = page.url().split('/clinic/visits/')[1].split(/[?#]/)[0];
  await page.waitForLoadState('networkidle');

  console.log('\nOn the review screen');
  const ask = page.getByRole('button', { name: 'Ask the patient' });
  const offered = await ask.count();
  ok('the clinician is offered a way to ask the patient', offered > 0);

  if (offered) {
    await ask.click();
    await page.waitForSelector('[role="dialog"]');
    const dialog = page.locator('[role="dialog"]');

    console.log('\nThe dialog');
    ok(
      'it says the visit waits and comes back',
      /comes back to you/i.test(await dialog.innerText()),
    );
    ok(
      'it warns the nudge carries nothing clinical',
      /nothing more|no medication/i.test(await dialog.innerText()),
    );

    const send = dialog.getByRole('button', { name: /Send and put on hold/ });
    await dialog.getByLabel('Your question').fill('too short');
    await send.click();
    await page.waitForTimeout(500);
    ok(
      'a question too short to answer is refused',
      /can actually answer/i.test(await dialog.innerText()),
    );

    // The suggestions exist so a clinician does not compose the same question
    // from scratch every time.
    const suggestion = dialog.locator('button', { hasText: /photograph of the affected/ }).first();
    ok('common questions are offered', (await suggestion.count()) > 0);
    await suggestion.click();
    await page.waitForTimeout(250);
    ok(
      'choosing one fills the box',
      ((await dialog.getByLabel('Your question').inputValue()) ?? '').length > 20,
    );

    await send.click();
    await page.waitForURL('**/clinic', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
    ok('sending returns the clinician to their queue', page.url().endsWith('/clinic'));

    // Asked of the visit itself rather than scanned off the queue page: the
    // queue shows one page, and a visit further down would fail a text search
    // for reasons that have nothing to do with the thing under test.
    const status = await page.evaluate(
      (id) => fetch(`/api/bff/v1/clinic/visits/${id}`).then((r) => r.json()).then((v) => v.status),
      visitId,
    );
    ok('and the visit is now waiting on the patient', status === 'INFO_REQUESTED', status);
  }

  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.reload();
  await page.waitForLoadState('networkidle');
  ok('no console errors', errors.length === 0, errors[0] ?? '');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
