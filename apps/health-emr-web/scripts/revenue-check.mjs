/**
 * The money surfaces: what the platform earns, what it keeps, and where the
 * pricing has gaps.
 *
 * The assertion that matters most is arithmetic. Revenue, cost, clinician fees
 * and profit are four numbers on one card, and three of them add up to the
 * fourth — a chart that does not balance is worse than no chart, because it is
 * believed. Read-only: it edits nothing.
 *
 *   node scripts/revenue-check.mjs
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:3005';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const failures = [];

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

const cents = (text) => Math.round(parseFloat((text ?? '0').replace(/[^0-9.-]/g, '')) * 100);

async function signIn(email, password, landing) {
  await page.context().clearCookies();
  await page.goto(`${WEB}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(`**${landing}`, { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}

console.log('\nPlatform overview');
await signIn('super@healthemr.test', 'Super!2026', '/super-admin');
await page.getByText('Revenue and profit').waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);

const figures = {};
for (const label of ['Revenue', 'Cost of goods', 'Clinician fees', 'Profit']) {
  const tile = page.locator(`[data-figure="${label}"]`).first();
  const value = await tile.locator('[data-figure-value]').first().textContent();
  figures[label] = cents(value);
  console.log(`  · ${label.padEnd(15)} ${value?.trim()}`);
}

check(
  'profit is revenue less both costs',
  figures.Profit === figures.Revenue - figures['Cost of goods'] - figures['Clinician fees'],
  `${figures.Revenue} - ${figures['Cost of goods']} - ${figures['Clinician fees']} = ${figures.Profit}`,
);
check('there is revenue to report', figures.Revenue > 0);

console.log('\nGrain toggle');
for (const label of ['Daily', 'Last 3 months', 'Monthly']) {
  const button = page.getByRole('button', { name: label, exact: true }).first();
  await button.click();
  await page.waitForTimeout(900);
  const bars = await page.locator('[role="img"] button').count();
  check(`${label} draws a series`, bars > 0, `${bars} buckets`);
}

console.log('\nBy client account');
const rows = await page.locator('table tbody tr').count();
check('every client is listed, including the quiet ones', rows > 0, `${rows} accounts`);

// A margin on no revenue is undefined, not 0% — a zero badge reads as "we make
// nothing on them", which is a different and wrong statement.
const margins = await page.locator('table tbody tr td:nth-child(7)').allTextContents();
const idle = await page.locator('table tbody tr td:nth-child(3)').allTextContents();
const zeroRevenueRows = idle.map((text, index) => ({ revenue: cents(text), margin: margins[index] }));
check(
  'an account with no revenue shows no margin rather than 0%',
  zeroRevenueRows.filter((row) => row.revenue === 0).every((row) => !row.margin.includes('0%')),
);

console.log('\nCatalogue pricing');
// A pharmacy that actually stocks something. Not every one does — clicking the
// first row lands on an empty catalogue and the assertions below fail for the
// wrong reason.
const stocked = await page.evaluate(async () => {
  const response = await fetch('/api/bff/v1/super-admin/medications?pageSize=1');
  if (!response.ok) return null;
  return (await response.json()).data?.[0]?.pharmacyId ?? null;
});

if (!stocked) {
  console.log('  – no pharmacy stocks anything; catalogue pricing not exercised');
} else {
  await page.goto(`${WEB}/super-admin/pharmacies/${stocked}`);
  await page.getByText('Categories').first().waitFor({ timeout: 20000 });
  // Wait for the catalogue table itself rather than a fixed delay. The page
  // holds two tables and the pricing one arrives second, so a timeout that is
  // generous on an idle machine reads only the other table on a busy one.
  await page
    .locator('table thead th', { hasText: 'We charge' })
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle');

  const headers = await page
    .locator('table thead th')
    .allTextContents()
    .then((all) => all.map((text) => text.trim()));
  check('the platform can see what it charges', headers.includes('We charge'), headers.join(' | '));
  check('the platform can see what it pays', headers.includes('Cost'));
  check(
    'the catalogue fits its panel',
    await page.evaluate(() => {
      const table = [...document.querySelectorAll('table')].find((node) =>
        node.innerText.includes('KIT ID'),
      );
      return table ? table.scrollWidth <= table.closest('div').clientWidth : false;
    }),
  );
  check(
    'products can be added and edited from here',
    (await page.getByRole('button', { name: /add product/i }).count()) > 0,
  );
}

console.log('\nClearing a blocked application');
// A provider claiming a state with no certificate for it cannot be approved,
// and before this there was nothing on the page that could clear it.
// The id comes from the API rather than by clicking through the list: that page
// uses a table with row handlers, not anchors, so there is nothing to select.
const applications = await page.evaluate(async () => {
  const response = await fetch('/api/bff/v1/super-admin/onboarding/providers?pageSize=5');
  return response.ok ? ((await response.json()).data ?? []) : [];
});
// Only an application still open. A decided one is a record, not a workspace —
// it correctly has no upload control and no verify button, so asserting them
// there would fail for the right reason at the wrong target.
const DECIDED = ['APPROVED', 'REJECTED', 'WITHDRAWN'];
const target = applications.find((row) => !DECIDED.includes(row.status));

if (target) {
  await page.goto(`${WEB}/super-admin/applications/provider/${target.id}`);
  await page.getByText('State licences').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);

  const outstanding = await page.locator('text=still outstanding').first().textContent();
  console.log(`  · ${outstanding?.trim()}`);

  // The count beside Documents has to match the reasons approval is refused.
  // It used to read "0 still required" next to a blocked approval, because one
  // counted document kinds and the other counted verified licences.
  const blockedBanner = await page.getByText('Approval is blocked').count();
  const zeroOutstanding = /·\s*0 still outstanding/.test(outstanding ?? '');
  check(
    'the outstanding count agrees with the block',
    blockedBanner === 0 || !zeroOutstanding,
    `banner ${blockedBanner}, ${outstanding?.trim()}`,
  );

  check(
    'a document can be uploaded for the applicant',
    (await page.getByRole('button', { name: /upload for them/i }).count()) > 0,
  );

  if (blockedBanner > 0) {
    check(
      'an unverified licence can be cleared by hand',
      (await page.getByRole('button', { name: /verify by hand/i }).count()) > 0,
    );

    // The note is the whole audit trail, so an empty one must not be accepted.
    await page.getByRole('button', { name: /verify by hand/i }).first().click();
    await page.waitForSelector('[role="dialog"]');
    const confirm = page.locator('[role="dialog"] button:has-text("Mark verified")');
    check('verifying without a note is refused', await confirm.isDisabled());
    await page.locator('[role="dialog"] textarea').fill('too short');
    check('a token note is refused too', await confirm.isDisabled());
    await page.keyboard.press('Escape');
  } else {
    console.log('  – nothing blocked right now; the verify path was not exercised');
  }
} else {
  console.log('  – no open provider applications; the review controls were not exercised');
}

console.log('\nWhat a pharmacy may not set');
await signIn('rx@firstchoice.test', 'Pharmacy!2026', '/dispensary');
await page.goto(`${WEB}/dispensary/catalog`);
await page.getByText('Categories').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);

const pharmacyHeaders = await page
  .locator('table thead th')
  .allTextContents()
  .then((all) => all.map((text) => text.trim()));
check('a pharmacy states its cost', pharmacyHeaders.includes('Cost'), pharmacyHeaders.join(' | '));
// Our margin is not theirs to read, and the API rejects the field from this
// route — so the column must not be here either.
check('a pharmacy never sees our price', !pharmacyHeaders.includes('We charge'));

await browser.close();

console.log(
  failures.length ? `\n${failures.length} failed: ${failures.join(', ')}\n` : '\nAll checks passed\n',
);
process.exit(failures.length ? 1 : 0);
