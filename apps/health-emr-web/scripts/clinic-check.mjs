/**
 * Walks the clinician's console the way its user does.
 *
 * The assertion that matters most is that the review page shows the
 * questionnaire and the identity document *before* the decision form. This page
 * previously read the queue list instead of the visit endpoint, which meant a
 * clinician approved from the medication lines alone — so this check exists to
 * stop that regressing silently.
 *
 * Read-only: it opens a visit but never submits a decision.
 *
 *   node scripts/clinic-check.mjs
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:3005';
// Lindqvist rather than Reyes: this queue carries visits that have an identity
// document on them, so the photo path is actually exercised rather than skipped.
const EMAIL = process.env.PROVIDER_EMAIL ?? 'dr.lindqvist@healthemr.test';
const PASSWORD = process.env.PROVIDER_PASSWORD ?? 'Provider!2026';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const where = message.location();
  consoleErrors.push(`${message.text()}${where && where.url ? ` [${where.url}]` : ''}`);
});

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

console.log('\nSigning in');
await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForURL('**/clinic', { timeout: 20000 }),
  page.click('button[type="submit"]'),
]);
check('lands on the clinic', new URL(page.url()).pathname === '/clinic', page.url());

console.log('\nQueue');
await page.waitForSelector('table tbody tr, [data-empty-state]', { timeout: 15000 });
const waiting = await page.locator('table tbody tr').count();
check('the queue has visits', waiting > 0, `${waiting} waiting`);

// Not `a[href="/clinic/earnings"]` on its own — the sidebar link matches that
// too, and matching it makes this assertion pass without the card existing.
const headline = page.locator('main a[href="/clinic/earnings"], h1 ~ * a[href="/clinic/earnings"]').first();
check('workload and balance are on the queue page', await headline.isVisible());
const headlineText = ((await headline.textContent()) ?? '').replace(/\s+/g, ' ').trim();
check('the balance is money, not a raw number', /\$[\d,]/.test(headlineText), headlineText);

console.log('\nWork and pay');
await page.goto(`${WEB}/clinic/earnings`);
await page.waitForSelector('h2', { timeout: 15000 });
check('reviews completed is shown', await page.getByText('Reviews completed').isVisible());
check('balance is shown', await page.getByText('Owed to you').isVisible());
check(
  'declining is priced the same, and says so',
  await page.getByText('Declining is clinical work too.').isVisible(),
);

const ledgerRows = await page.locator('table tbody tr').count();
console.log(`  · ${ledgerRows} ledger lines`);

// The totals have to be the lines added up, or one of them is lying.
if (ledgerRows > 0) {
  const fees = await page
    .locator('table tbody tr td:nth-child(6)')
    .allTextContents();
  const parsed = fees.map((text) => Math.round(parseFloat(text.replace(/[^0-9.]/g, '')) * 100));
  check('every line carries a fee', parsed.every((cents) => Number.isFinite(cents) && cents > 0));
}

console.log('\nReview a visit');
await page.goto(`${WEB}/clinic`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.locator('a[href^="/clinic/visits/"]').first().click();
await page.waitForURL('**/clinic/visits/*', { timeout: 15000 });
await page.waitForSelector('h2', { timeout: 15000 });

check('shows the intake questionnaire', await page.getByText('Intake questionnaire').isVisible());
const answers = await page.locator('dl dt').count();
check('the questionnaire has answers', answers > 3, `${answers} questions`);

check('shows the identity section', await page.getByText('Identity and uploads').isVisible());
check('shows clinical history', await page.getByText('Clinical history').isVisible());
check('shows the decision form', await page.getByText('Decide every line').isVisible());

// Order matters: the chart has to come before the decision, not after it.
const positions = await page.evaluate(() => {
  const find = (text) =>
    [...document.querySelectorAll('h3, h4, p, span, div')]
      .find((node) => node.textContent?.trim() === text)
      ?.getBoundingClientRect().top ?? null;
  return { qa: find('Intake questionnaire'), decide: find('Decide every line') };
});
check(
  'the chart is read before the decision is made',
  positions.qa !== null && positions.decide !== null && positions.qa < positions.decide,
  `qa at ${Math.round(positions.qa ?? -1)}, form at ${Math.round(positions.decide ?? -1)}`,
);

console.log('\nWriting the prescription');
// Structured entry rather than one free-text box: the directions are composed
// from the fields, so a clinician cannot approve 0.25mg and type 0.5mg onto the
// label. Same `composeSig` runs on the server, so what is previewed is stored.
// The whole label, minus the required marker. Reading `span:first-child` used
// to work and now picks up the asterisk instead of the words.
const fieldLabels = (await page.locator('form label').allTextContents())
  .map((text) => text.replace(/\*$/, '').trim())
  .filter(Boolean);
for (const expected of ['Dose', 'How is it taken?', 'How often?', 'Plan length', 'Note to the patient']) {
  check(`asks for ${expected.toLowerCase().replace(/\?$/, '')}`, fieldLabels.includes(expected));
}

const directions = () => page.locator('form textarea').first().inputValue();

// By label, not by index. Filling `form input` positionally meant any change to
// the field order silently typed the plan length into the injection site.
const field = (label) => page.getByLabel(label).first();

await field(/^Dose/).fill('0.25mg');
await page.waitForTimeout(250);

await page.locator('[role="combobox"]').nth(1).click();
await page.waitForSelector('[role="listbox"]');
await page.locator('[role="option"]', { hasText: 'Subcutaneous injection' }).first().click();
await page.waitForTimeout(350);

// The site question only appears where it is a real instruction.
check('an injection asks where on the body', await page.getByText('Where on the body?').isVisible());

await field(/^Where on the body/).fill('abdomen, rotating sites');
await page.waitForTimeout(150);
await field(/^How often/).fill('once weekly');
await page.waitForTimeout(150);
await field(/^Plan length/).fill('28');
await page.waitForTimeout(400);

const composed = await directions();
check(
  'the directions compose from the fields',
  composed === 'Inject 0.25mg subcutaneously into the abdomen, rotating sites once weekly for 28 days.',
  composed,
);

// Editing the wording has to stop it being overwritten on the next keystroke.
await page.locator('form textarea').first().fill('Inject into the abdomen every Monday morning.');
await field(/^How often/).fill('twice weekly');
await page.waitForTimeout(350);
check(
  'an edited sentence is not overwritten',
  (await directions()) === 'Inject into the abdomen every Monday morning.',
  await directions(),
);

console.log('\nIdentity across the queue');
// Every visit must land on one side or the other: the document is shown, or the
// clinician is told there isn't one. Neither — a silently empty panel — is the
// failure worth guarding against, because it reads as "already verified".
await page.goto(`${WEB}/clinic`);
await page.waitForSelector('a[href^="/clinic/visits/"]');
const links = (await page.locator('a[href^="/clinic/visits/"]').evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute('href')),
)).slice(0, 12);

let withPhoto = 0;
let warned = 0;
for (const href of links) {
  await page.goto(`${WEB}${href}`);
  await page.waitForSelector('h2', { timeout: 15000 });
  const images = await page.locator('img[src*="/photos/"]').count();
  const warning = await page.getByText('No identity document on this visit.').isVisible();
  if (images > 0) withPhoto += 1;
  if (warning) warned += 1;
  if (images === 0 && !warning) {
    check(`${href} says something about identity`, false, 'no photo and no warning');
  }
}
check(
  'each visit either shows the ID or says there is none',
  withPhoto + warned === links.length,
  `${withPhoto} with a photo, ${warned} warned, of ${links.length}`,
);

if (withPhoto === 0) {
  console.log('  – no queued visit carries a photo, so rendering was not exercised');
}

console.log('\nBoundaries');
// A clinician has no business in another role's console.
for (const [path, role] of [
  ['/admin/visits', 'client business'],
  ['/super-admin/patients', 'platform owner'],
]) {
  const response = await page.goto(`${WEB}${path}`);
  const blocked = response.status() >= 400 || !page.url().includes(path);
  check(`cannot reach the ${role} console`, blocked, `${response.status()} → ${page.url()}`);
}

console.log('\nConsole');
const real = consoleErrors.filter((text) => !text.includes('favicon'));
real.forEach((text) => console.log('    ·', text));
check('no console errors', real.length === 0, `${real.length} of ${consoleErrors.length}`);

await browser.close();

console.log(
  failures.length ? `\n${failures.length} failed: ${failures.join(', ')}\n` : '\nAll checks passed\n',
);
process.exit(failures.length ? 1 : 0);
