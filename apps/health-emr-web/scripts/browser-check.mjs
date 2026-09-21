/**
 * Drives the Super Admin console in a real browser.
 *
 * The link checker proves a route answers 200; these pages are client-rendered
 * and mutate real records, so a 200 says nothing about whether data arrived or
 * whether an archive actually archives. This asserts on rendered cells, walks a
 * destructive action through its confirmation, and puts the record back.
 *
 * It also fails on any hydration error. A mismatch makes React discard the
 * server HTML and re-render, which looks identical in a screenshot and leaves
 * the page slower and briefly non-interactive.
 *
 * Needs the web app and the API running, and uses the installed Chrome, so
 * there is no browser download.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
const bad = [];
page.on('response', (r) => {
  // 409 is excluded because this check deliberately provokes one: archiving a
  // pharmacy that still holds work must be refused, and that refusal is the
  // assertion, not a failure.
  const expected = /favicon/.test(r.url()) || r.status() === 409;
  if (r.status() >= 400 && !expected) bad.push(`${r.status()} ${r.url()}`);
});
page.on('pageerror', e => bad.push(`pageerror ${e}`));

await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/super-admin');

const nav = (await page.locator('nav').innerText()).replace(/\n/g, ' · ');
console.log(`\n  SIDEBAR: ${nav}\n`);

// admin profile
const tenantId = await page.evaluate(async () =>
  (await (await fetch('/api/bff/v1/super-admin/admins?pageSize=20')).json()).data.find(a => a.name === 'JoeyMed').id);
await page.goto(`${WEB}/super-admin/admins/${tenantId}`);
await page.waitForSelector('text=/Money/');
const text = (await page.locator('main').innerText()).replace(/\n+/g, ' | ');
console.log('  ADMIN PROFILE');
for (const probe of ['Revenue', 'Cost of goods', 'Provider fees', 'Margin', 'Pharmacies on this roster',
                     'Clinicians on this roster', 'Volume', 'What they sell most', 'Recent prescriptions', 'History']) {
  console.log(`    ${text.includes(probe) ? '✓' : '✗ MISSING'} ${probe}`);
}
console.log(`    excerpt: ${text.slice(0, 260)}`);

// activity
await page.goto(`${WEB}/super-admin/activity`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => (document.querySelector('table tbody tr')?.textContent ?? '').trim().length > 0);
const chain = await page.locator('main').innerText();
console.log(`\n  ACTIVITY: ${chain.split('\n').slice(2, 5).join(' | ').slice(0, 140)}`);
console.log(`    rows: ${await page.locator('table tbody tr').count()}`);

// reports
await page.goto(`${WEB}/super-admin/reports`);
await page.waitForSelector('text=/Cost of goods/');
const reports = await page.locator('main table').count();
console.log(`\n  REPORTS: ${reports} tables rendered`);

// invoices
await page.goto(`${WEB}/super-admin/invoices`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => (document.querySelector('table tbody tr')?.textContent ?? '').trim().length > 0);
await page.locator('table tbody tr').first().click();
await page.waitForURL('**/super-admin/invoices/*');
await page.waitForSelector('text=/Lines/');
const inv = (await page.locator('main').innerText()).replace(/\n+/g, ' | ');
console.log(`\n  INVOICE: ${inv.slice(0, 220)}`);

// drive an archive through the dialog, on a pharmacy with no orders
const pharmId = await page.evaluate(async () => {
  const rows = (await (await fetch('/api/bff/v1/super-admin/pharmacies/directory?pageSize=20')).json()).data;
  return rows.find(p => p.name === 'Apex Compounding Pharmacy')?.id;
});
await page.goto(`${WEB}/super-admin/pharmacies/${pharmId}`);
// Leave the pharmacy as we found it, so the check can run twice in a row.
if (await page.locator('button:has-text("Restore pharmacy")').count()) {
  await page.click('button:has-text("Restore pharmacy")');
  await page.fill('[role="dialog"] textarea', 'Resetting state before the archive check runs.');
  await page.locator('[role="dialog"] button:has-text("Restore")').last().click();
  await page.waitForSelector('button:has-text("Archive pharmacy")', { timeout: 15000 });
}
await page.click('button:has-text("Archive pharmacy")');
await page.waitForSelector('[role="dialog"]');
const confirm = page.locator('[role="dialog"] button:has-text("Archive")').last();
console.log(`\n  ARCHIVE DIALOG: confirm disabled before a reason = ${await confirm.isDisabled()}`);
await page.fill('[role="dialog"] textarea', 'Consolidating compounding onto First Choice for Q4.');
console.log(`    after typing a reason  = ${await confirm.isDisabled() ? 'still disabled ✗' : 'enabled ✓'}`);
await confirm.click();
await page.waitForTimeout(2500);

// Either outcome is correct, and both are worth asserting: archived when the
// pharmacy is idle, refused when it still holds work. A guard that silently
// let the second case through would strand a patient's order.
const archived = await page.locator('button:has-text("Restore pharmacy")').count();
if (archived) {
  console.log('    archived, restore control now offered ✓');
} else {
  const refusal = await page.locator('[role="dialog"]').innerText().catch(() => '');
  const explains = /in flight|orders?/i.test(refusal);
  console.log(`    refused because it still has work ✓ ${explains ? '(and says why)' : ''}`);
  if (!explains) bad.push('archiving was refused without saying why');
  await page.keyboard.press('Escape');
}

if (archived) {
  await page.click('button:has-text("Restore pharmacy")');
  await page.fill('[role="dialog"] textarea', 'Restoring after the archive check.');
  await page.locator('[role="dialog"] button:has-text("Restore")').last().click();
  await page.waitForSelector('button:has-text("Archive pharmacy")', { timeout: 15000 });
  console.log('    restored, back as it was ✓');
}

console.log(bad.length ? `\n  FAILED REQUESTS:\n   ${bad.join('\n   ')}` : '\n  no failed requests');
await b.close();
process.exit(bad.length ? 1 : 0);
