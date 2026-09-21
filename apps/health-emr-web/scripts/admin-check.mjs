/**
 * Walks the client-business console the way its user does.
 *
 * Asserts the four things the role exists for: the overview counts, the patient
 * and prescription tables, the visit list with its one derived status, and a
 * visit's detail page with the intake it collected. Read-only — nothing here
 * writes, so it is safe to run against a working database.
 *
 *   node scripts/admin-check.mjs
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@joeymed.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin!2026';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const failures = [];
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() !== 'error') return;
  // "Failed to load resource" on its own is unfixable; the location carries the
  // URL that actually failed.
  const where = message.location();
  const url = where && where.url ? ` [${where.url}]` : '';
  consoleErrors.push(`${message.text()}${url}`);
});

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

/**
 * Waits for rows that actually carry data.
 *
 * The table renders skeleton rows while the request is in flight, so waiting on
 * `tbody tr` alone returns a page of empty cells — and every assertion after it
 * reads blank and fails for the wrong reason.
 */
async function rowCount() {
  await page.waitForSelector('table tbody tr, [data-empty-state]', { timeout: 15000 });
  await page
    .waitForFunction(
      () => (document.querySelector('table tbody tr')?.textContent ?? '').trim().length > 0,
      { timeout: 15000 },
    )
    .catch(() => {});
  return page.locator('table tbody tr').count();
}

async function cells(rowIndex = 0) {
  return page.locator('table tbody tr').nth(rowIndex).locator('td').allTextContents();
}

async function columnIndex(header) {
  const headers = await page.locator('table thead th').allTextContents();
  return headers.findIndex((text) => text.replace(/[▼▲]/g, '').trim() === header);
}

console.log('\nSigning in');
await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/admin', { timeout: 20000 });
check('lands on the admin console', page.url().endsWith('/admin'));

/**
 * The URL now arrives before the content does.
 *
 * The console renders its shell and a set of placeholders the moment the route
 * resolves, rather than leaving the page blank until the data lands — so
 * waiting on the URL is no longer waiting for anything to read.
 */
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
await page.waitForLoadState('networkidle');

console.log('\nOverview');
// Closed stages are only drawn when they have something in them, so the tile
// count is the three that always need watching plus every open stage.
for (const stage of ['STUCK', 'INFO_NEEDED', 'PENDING_REVIEW', 'APPROVED', 'SHIPPED']) {
  const tile = page.locator(`a[href="/admin/visits?stage=${stage}"]`).first();
  check(`${stage} has a tile`, await tile.isVisible());
}
const stuckCount = await page
  .locator('a[href="/admin/visits?stage=STUCK"] span')
  .first()
  .textContent();
console.log(`  · ${stuckCount?.trim()} stuck right now`);

console.log('\nMoney');
check('this month is on the overview', await page.getByText('This month', { exact: true }).isVisible());
// `.first()` throughout: the card labels also appear inside the subtitles that
// explain them, and a bare getByText matches both.
check(
  'what patients paid is shown',
  await page.getByText('Patients paid you', { exact: true }).first().isVisible(),
);
check('what they owe us is shown', await page.getByText('You owe us', { exact: true }).first().isVisible());
check('their own margin is shown', await page.getByText('Your margin', { exact: true }).first().isVisible());
const figure = page.getByText(/^\$[\d,]+\.\d{2}$/).first();
check('spend is money, not a raw count', await figure.isVisible(), (await figure.textContent()) ?? '');

// Their margin is theirs. Ours is not — our cost base and what we keep are
// absent from the payload, and this checks the page never reintroduces them.
const pageText = (await page.locator('body').innerText()).toLowerCase();
for (const leak of ['cost of goods', 'clinician fees', 'profit']) {
  check(`does not show the platform's ${leak}`, !pageText.includes(leak));
}

check('margin chart is present', await page.getByText('Your margin over time').isVisible());

console.log('\nNavigation');
for (const [label, href] of [
  ['Patients', '/admin/patients'],
  ['Visits', '/admin/visits'],
  ['Prescriptions', '/admin/prescriptions'],
]) {
  const link = page.locator(`nav a[href="${href}"]`).first();
  check(`${label} is in the sidebar`, await link.isVisible());
}

console.log('\nPatients');
await page.goto(`${WEB}/admin/patients`);
const patients = await rowCount();
check('the table has rows', patients > 0, `${patients} rows`);
const phone = (await cells())[await columnIndex('Phone')] ?? '';
check('phone is grouped for reading', /^\(\d{3}\) \d{3}-\d{4}$/.test(phone.trim()), phone.trim());

// Email is its own column, not buried in a sub-line under the name.
const emailAt = await columnIndex('Email');
check('email has its own column', emailAt >= 0);
const email = (await cells())[emailAt] ?? '';
check('and it carries an address', /@/.test(email), email.trim());

// Everything the record holds is reachable, even when it starts hidden.
await page.getByRole('button', { name: /columns/i }).first().click();
await page.waitForTimeout(300);
const offered = (await page.locator('label:has(input[type=checkbox])').allTextContents())
  .map((text) => text.trim())
  .filter(Boolean);
const shownNow = (await page.locator('table thead th').allTextContents()).filter((t) => t.trim());
check(
  'hidden columns are offered in the Columns menu',
  offered.length > shownNow.length,
  `${shownNow.length} shown of ${offered.length}`,
);

// Turning one on has to actually reveal it.
const hiddenOne = offered.find((label) => !shownNow.some((head) => head.includes(label)));
if (hiddenOne) {
  await page.locator('label:has(input[type=checkbox])', { hasText: hiddenOne }).first().click();
  await page.waitForTimeout(400);
  const after = (await page.locator('table thead th').allTextContents()).map((t) => t.trim());
  check(`turning on "${hiddenOne}" shows it`, after.some((head) => head.includes(hiddenOne)));

  // And the choice survives a reload, or nobody bothers a second time.
  await page.reload();
  await rowCount();
  const reloaded = (await page.locator('table thead th').allTextContents()).map((t) => t.trim());
  check('the choice is remembered', reloaded.some((head) => head.includes(hiddenOne)));

  // Put it back so the next run starts from the defaults.
  await page.getByRole('button', { name: /columns/i }).first().click();
  await page.waitForTimeout(300);
  await page.locator('label:has(input[type=checkbox])', { hasText: hiddenOne }).first().click();
  await page.waitForTimeout(300);
}
await page.keyboard.press('Escape');

console.log('\nPrescriptions');
await page.goto(`${WEB}/admin/prescriptions`);
const prescriptions = await rowCount();
check('the table has rows', prescriptions > 0, `${prescriptions} rows`);

console.log('\nVisits');
await page.goto(`${WEB}/admin/visits`);
const visits = await rowCount();
check('the table has rows', visits > 0, `${visits} rows`);

const statusColumn = await columnIndex('Status');
const allStatuses = await page
  .locator(`table tbody tr td:nth-child(${statusColumn + 1})`)
  .allTextContents();
check(
  'every visit carries a status',
  allStatuses.length > 0 && allStatuses.every((text) => text.trim().length > 0),
  [...new Set(allStatuses.map((text) => text.trim()))].slice(0, 4).join(' | '),
);

// The filter must narrow in SQL, so the count it reports is the real one.
await page.goto(`${WEB}/admin/visits?stage=SHIPPED`);
const shippedRows = await rowCount();
if (shippedRows > 0) {
  const labels = await page
    .locator(`table tbody tr td:nth-child(${statusColumn + 1})`)
    .allTextContents();
  check(
    'the stage filter returns only that stage',
    labels.every((label) => label.trim().startsWith('Shipped')),
    [...new Set(labels.map((text) => text.trim()))].join(' | '),
  );
} else {
  console.log('  – nothing shipped right now; filter not exercised');
}

// And the count a tile promised is the count the table delivers.
await page.goto(`${WEB}/admin/visits?stage=STUCK`);
const stuckRows = await rowCount();
check('the stuck filter matches its tile', String(stuckRows) === stuckCount?.trim(), `${stuckRows} rows vs tile ${stuckCount?.trim()}`);

console.log('\nVisit detail');
await page.goto(`${WEB}/admin/visits`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await rowCount();
await page.locator('table tbody tr').first().click();
await page.waitForURL('**/admin/visits/*', { timeout: 15000 });

const heading = await page.locator('h2').first().textContent();
check('opens on the patient', (heading ?? '').trim().length > 0, heading?.trim());
check('shows the intake questionnaire', await page.getByText('Intake questionnaire').isVisible());
check('shows what was requested', await page.getByText('What was requested').isVisible());
check(
  'names what is withheld rather than showing it empty',
  await page.getByText('Not shown to you').isVisible(),
);
check(
  'does not show provider notes',
  !(await page.getByText('Provider notes', { exact: true }).isVisible().catch(() => false)),
);

console.log('\nConsole');
const real = consoleErrors.filter((text) => !text.includes('favicon'));
real.forEach((text) => console.log('    ·', text));
check('no console errors', real.length === 0, `${real.length} of ${consoleErrors.length}`);

await browser.close();

console.log(
  failures.length ? `\n${failures.length} failed: ${failures.join(', ')}\n` : '\nAll checks passed\n',
);
process.exit(failures.length ? 1 : 0);
