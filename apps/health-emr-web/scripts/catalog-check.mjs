/**
 * Drives a pharmacy's own catalogue: categories, days supply, and the products
 * a client can then order by `medId`.
 *
 * This is the surface intake validates against — a visit naming a medication
 * the chosen pharmacy does not carry is refused — so a catalogue that silently
 * fails to save is a stream of rejected visits nobody can explain.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
const bad = [];
page.on('pageerror', e => bad.push(String(e).slice(0, 120)));
page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });

await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', 'rx@firstchoice.test');
await page.fill('input[name="password"]', 'Pharmacy!2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/dispensary');
console.log(`  nav: ${(await page.locator('nav a').allInnerTexts()).map(t=>t.trim()).join(' · ')}`);

await page.goto(`${WEB}/dispensary/catalog`);
await page.waitForSelector('text=/Categories/');
await page.waitForTimeout(900);
const cats = await page.locator('aside, main').first().innerText();
console.log(`\n  categories listed:`);
for (const line of (await page.locator('main ul li button').allInnerTexts())) {
  console.log(`    ${line.replace(/\n/g, ' · ')}`);
}

// Pick a category that actually holds something — the list is ordered by the
// pharmacy's own sortOrder, and the first one may legitimately be empty.
const stocked = page.locator('main ul li button').filter({ hasText: /[1-9]\d* product/ }).first();
await stocked.click();
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
console.log(`\n  products in ${(await stocked.innerText()).split('\n')[0]}: ${await page.locator('table tbody tr').count()}`);
console.log(`  columns: ${(await page.locator('table thead th').allInnerTexts()).filter(Boolean).join(' · ')}`);
console.log(`  first row: ${(await page.locator('table tbody tr').first().innerText()).replace(/\s+/g,' ').slice(0,110)}`);

// Nothing is removed without a confirmation that names it and says what will
// actually happen — deletion, or deactivation for anything already dispensed.
const target = page.locator('table tbody tr').first();
const targetName = (await target.locator('button[aria-label^="Remove"]').getAttribute('aria-label'))
  .replace('Remove ', '');
const rowsBefore = await page.locator('table tbody tr').count();

await target.locator('button[aria-label^="Remove"]').click();
await page.waitForSelector('[role="dialog"]');
const warning = (await page.locator('[role="dialog"]').innerText()).replace(/\s+/g, ' ');
console.log(`\n  delete confirmation: ${warning.slice(0, 220)}`);
if (!warning.includes(targetName)) bad.push('the delete dialog does not name what it is removing');
if (!/deactivated|deleted/.test(warning)) bad.push('the delete dialog does not say what will happen');

await page.locator('[role="dialog"] button:has-text("Cancel")').click();
await page.waitForSelector('[role="dialog"]', { state: 'detached' });
const rowsAfter = await page.locator('table tbody tr').count();
console.log(`  cancel left it alone: ${rowsAfter === rowsBefore}`);
if (rowsAfter !== rowsBefore) bad.push('cancelling the delete dialog still removed the product');

// Add a category through the dialog. Unique per run: a fixed name means one
// interrupted run leaves a row behind that makes every later run fail on a
// duplicate-name conflict.
const STAMP = Date.now().toString().slice(-6);
const RUN = `Sleep support ${STAMP}`;
// Kit codes are unique per pharmacy, so this has to vary per run for the same
// reason the category name does.
const KIT = `FC-MELA-${STAMP}`;

// add a category through the dialog
await page.locator('button:has-text("Add")').first().click();
await page.waitForSelector('[role="dialog"]');
await page.fill('[role="dialog"] input >> nth=0', RUN);
console.log(`\n  slug preview: ${(await page.locator('[role="dialog"]').innerText()).match(/Saved as “([^”]+)”/)?.[1]}`);
await page.fill('[role="dialog"] input[type="number"]', '30');
await page.locator('[role="dialog"] button:has-text("Add category")').click();
await page.waitForSelector('[role="dialog"]', { state: 'detached' });
await page.waitForTimeout(900);
console.log(`  added: ${(await page.locator('main ul li button').allInnerTexts()).some((t) => t.includes(RUN))}`);

// add a product, leaving days supply blank to inherit
await page.locator('button:has-text("Add product")').click();
await page.waitForSelector('[role="dialog"]');
const hint = (await page.locator('[role="dialog"]').innerText()).match(/Blank inherits this category's (\d+) days/);
console.log(`  product dialog says: inherits ${hint?.[1]} days`);
await page.fill('[role="dialog"] input >> nth=0', KIT);
await page.fill('[role="dialog"] input >> nth=1', 'Melatonin 5');
await page.fill('[role="dialog"] input >> nth=2', 'Melatonin 5mg');
await page.fill('[role="dialog"] input >> nth=3', '5mg');
await page.locator('[role="dialog"] button:has-text("Add product")').click();
await page.waitForSelector('[role="dialog"]', { state: 'detached' }).catch(() => {});
await page.waitForTimeout(1000);
const row = await page.locator('table tbody tr').first().innerText();
console.log(`  product row: ${row.replace(/\s+/g,' ').slice(0,110)}`);

// Put the catalogue back as it was found. Target what this run created by
// name — an earlier version clicked the first "Remove" on the page, which
// deactivated whichever category happened to be selected instead.
await page.locator('table tbody tr', { hasText: KIT })
  .locator('button[aria-label^="Remove"]')
  .click();
await page.waitForSelector('[role="dialog"]');
await page.locator('[role="dialog"] button:has-text("Remove product")').click();
await page.waitForSelector('[role="dialog"]', { state: 'detached' });
await page.waitForTimeout(700);

const created = page.locator('main ul li button', { hasText: RUN });
await created.click();
await page.waitForTimeout(600);
// The list marks the selected category; confirm it is ours before removing
// anything, so a mis-click can never take out a real category.
const isSelected = (await created.getAttribute('aria-current')) === 'true';
if (!isSelected) bad.push('could not select the category this run created — refusing to remove anything');
else {
  await page.locator('button:has-text("Remove")').first().click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] button:has-text("Remove category")').click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  await page.waitForTimeout(900);
}

const left = (await page.locator('main ul li button').allInnerTexts()).some((t) => t.includes(RUN));
if (left) bad.push('the test category was not cleaned up');
console.log(`  cleaned up: ${!left}`);

console.log(bad.length ? `\n  PROBLEMS: ${bad.join(' | ')}` : '\n  clean');
await b.close();
process.exit(bad.length ? 1 : 0);
