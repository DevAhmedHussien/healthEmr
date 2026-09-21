/**
 * Drives the pharmacy fill queue: search, filters, and acting on a row.
 *
 * The queue is a worklist, so the things that matter are that a pharmacist can
 * find one order by whatever identifier they were handed, and act on it without
 * leaving the row. Both are only observable in a browser.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
const bad = [];
page.on('pageerror', (e) => bad.push(String(e).slice(0, 120)));
page.on('response', (r) => {
  if (r.status() >= 400 && !/favicon/.test(r.url())) bad.push(`${r.status()} ${new URL(r.url()).pathname}`);
});

await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', 'rx@firstchoice.test');
await page.fill('input[name="password"]', 'Pharmacy!2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/dispensary');
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => (document.querySelector('table tbody tr')?.textContent ?? '').trim().length > 0);

const columns = (await page.locator('table thead th').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
console.log(`  columns: ${columns.filter(Boolean).join(' · ')}`);
console.log(`  rows: ${await page.locator('table tbody tr').count()}`);
console.log(`  first: ${(await page.locator('table tbody tr').first().innerText()).replace(/\s+/g, ' ').slice(0, 110)}`);

// allergies visible without opening anything
const hasAllergy = (await page.locator('table tbody').innerText()).match(/shellfish|penicillin|sulfa/i);
console.log(`  allergies shown on the row: ${Boolean(hasAllergy)}`);

// search by something that is not the patient's name
await page.fill('input[type="search"], input[placeholder*="Search"]', 'Austin');
await page.waitForTimeout(1200);
const afterSearch = await page.locator('table tbody tr').count();
console.log(`\n  search "Austin" → ${afterSearch} rows · url ${new URL(page.url()).search}`);
if (!new URL(page.url()).search.includes('q=Austin')) bad.push('search did not reach the URL');

await page.fill('input[type="search"], input[placeholder*="Search"]', '');
await page.waitForTimeout(1000);

// filter
// The filter controls are a disclosure, and a table that arrives with a filter
// already applied opens itself — so clicking unconditionally would close it.
if (!(await page.locator('tr.ar-filter-row').count())) {
  await page.locator('button', { hasText: /^Filters?/ }).first().click();
  await page.waitForSelector('tr.ar-filter-row');
}
await page.waitForTimeout(400);
const scope = page.locator('[role="combobox"]').filter({ hasText: /Any|Still to fill|Everything/ });
console.log(`  filters available: ${await scope.count()}`);
const status = page.locator('[role="combobox"]').first();
await status.click();
await page.waitForSelector('[role="listbox"]');
console.log(`  status options: ${(await page.locator('[role="option"]').allInnerTexts()).map((t) => t.trim()).join(', ')}`);
await page.locator('[role="option"]', { hasText: 'submitted' }).first().click();
await page.waitForTimeout(1200);
console.log(`  filtered → ${await page.locator('table tbody tr').count()} rows · ${new URL(page.url()).search}`);

// act on a row
await page.locator('button:has-text("Clear")').first().click().catch(() => {});
await page.waitForTimeout(1200);
// ── the actions stay reachable on a wide table ──
//
// This queue is wider than the window: seventeen columns are available and the
// buttons are the last of them. Unpinned, acting on a row means scrolling to the
// end first, every time.
const pinned = await page.evaluate(() => {
  const table = document.querySelector('table');
  const box = table.parentElement;
  const before = table.querySelector('tbody tr td:last-child button')?.getBoundingClientRect().right;
  box.scrollLeft = 9999;
  const cell = table.querySelector('tbody tr td:last-child');
  const after = cell?.querySelector('button')?.getBoundingClientRect();
  const style = getComputedStyle(cell);
  const frame = box.getBoundingClientRect();
  box.scrollLeft = 0;
  return {
    scrolls: table.scrollWidth > box.clientWidth,
    held: before !== undefined && after !== undefined && Math.abs(before - after.right) < 2,
    position: style.position,
    // Transparent would let the columns underneath show through as they pass.
    opaque: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
    inView: after ? after.right <= frame.right + 2 : false,
  };
});

if (pinned.scrolls) {
  if (pinned.position !== 'sticky') bad.push('the actions column is not pinned');
  if (!pinned.held) bad.push('the actions column moves when the table scrolls');
  if (!pinned.opaque) bad.push('the pinned actions cell is transparent');
  if (!pinned.inView) bad.push('the actions are off screen at full scroll');
  console.log(`\n  actions pinned through a full scroll: ${pinned.held && pinned.inView}`);
} else {
  console.log('\n  table fits; pinning not exercised');
}

// ── the tooltip escapes the row it lives in ──
//
// `.ar-table tbody td` sets `overflow: hidden` to keep rows one line tall, and a
// clipping ancestor beats any z-index. Absolutely positioned inside the cell,
// all that showed was the sliver of the bubble that fell inside it — no error,
// just a dark line. Hence measuring it rather than checking it exists.
const tipTrigger = page.locator('table tbody tr span[tabindex="0"]').first();
if (await tipTrigger.count()) {
  await tipTrigger.hover();
  await page.waitForTimeout(450);

  const tip = await page.evaluate(() => {
    const node = document.querySelector('[role="tooltip"]');
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      clipped: node.closest('td') !== null,
      visible: getComputedStyle(node).visibility === 'visible',
      onScreen:
        box.top >= 0 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    };
  });

  if (!tip) bad.push('hovering a truncated cell shows no tooltip');
  else {
    if (tip.clipped) bad.push('the tooltip is still inside the cell that clips it');
    if (!tip.visible) bad.push('the tooltip never became visible');
    if (!tip.onScreen) bad.push('the tooltip is positioned off screen');
    // A clipped bubble measured about 4px tall. A real one is a readable box.
    if (tip.height < 16 || tip.width < 40) {
      bad.push(`the tooltip collapsed to ${tip.width}x${tip.height}`);
    }
    console.log(`\n  tooltip: ${tip.width}x${tip.height}, escapes the row = ${!tip.clipped}`);
  }

  await page.mouse.move(0, 0);
}

// A queue with nothing open is a legitimate state — everything may have
// shipped, or been rerouted elsewhere. Say so rather than failing.
const ship = page.locator('table tbody tr button:has-text("Ship")').first();
if (!(await ship.count())) {
  console.log('\n  nothing open to ship — skipping the shipment dialog');
  console.log(bad.length ? `\n  PROBLEMS: ${bad.join(' | ')}` : '\n  clean');
  await b.close();
  process.exit(bad.length ? 1 : 0);
}
await ship.click();
await page.waitForSelector('[role="dialog"]');
const dialog = (await page.locator('[role="dialog"]').innerText()).replace(/\s+/g, ' ');
console.log(`\n  ship dialog: ${dialog.slice(0, 190)}`);
if (!/Ship to|,/.test(dialog)) bad.push('the ship dialog does not show where it is going');
const confirm = page.locator('[role="dialog"] button:has-text("Mark shipped")');
console.log(`  confirm disabled without a tracking number: ${await confirm.isDisabled()}`);

// This dialog is opened from a button inside a table cell, and a `position:
// fixed` panel does not escape the DOM. While it was still a descendant of the
// `<td>` it inherited `white-space: nowrap` and the description ran straight out
// of the panel and across the page — a silent break, since nothing errored.
const geometry = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"]');
  const box = panel.getBoundingClientRect();
  const texts = [...panel.querySelectorAll('p')];
  return {
    portalled: panel.closest('td') === null,
    withinViewport: box.left >= 0 && box.right <= window.innerWidth,
    textOverflows: texts.some((p) => p.getBoundingClientRect().right > box.right),
    nowrap: getComputedStyle(panel).whiteSpace === 'nowrap',
  };
});

if (!geometry.portalled) bad.push('the dialog is still inside the table cell that opened it');
if (!geometry.withinViewport) bad.push('the dialog is not fully on screen');
if (geometry.textOverflows) bad.push('dialog text spills outside the panel');
if (geometry.nowrap) bad.push('the dialog inherited white-space: nowrap');

const textarea = await page
  .locator('[role="dialog"] textarea')
  .first()
  .evaluate((node) => getComputedStyle(node).whiteSpace)
  .catch(() => null);
if (textarea && textarea === 'nowrap') bad.push('the textarea will not wrap what is typed into it');

await page.keyboard.press('Escape');
await page.waitForSelector('[role="dialog"]', { state: 'detached' });

console.log(bad.length ? `\n  PROBLEMS: ${bad.join(' | ')}` : '\n  clean');
await b.close();
process.exit(bad.length ? 1 : 0);
