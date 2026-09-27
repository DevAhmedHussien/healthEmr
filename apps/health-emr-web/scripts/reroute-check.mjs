/**
 * The two screens that exist for when something has gone wrong: a pharmacy's
 * own settings, and the Super Admin view of orders nobody is working.
 *
 * Both are only meaningful in a browser — whether a pharmacy can actually edit
 * its own connection, and whether a stuck order can be moved somewhere that can
 * fill it.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3005';
const b = await chromium.launch({ channel: 'chrome' });
const bad = [];

async function signIn(page, email, password, landing) {
  await page.goto(`${WEB}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`**${landing}`);
}

// ── the pharmacy's own settings ──
const pharmacy = await b.newPage();
pharmacy.on('pageerror', (e) => bad.push(`pharmacy: ${String(e).slice(0, 90)}`));
await signIn(pharmacy, 'rx@firstchoice.test', 'Pharmacy!2026', '/dispensary');
console.log(`  pharmacy nav: ${(await pharmacy.locator('nav a').allInnerTexts()).map((t) => t.trim()).join(' · ')}`);

await pharmacy.goto(`${WEB}/dispensary/settings`);
await pharmacy.waitForSelector('text=/Connection to your system/');
const settings = (await pharmacy.locator('main').innerText()).replace(/\s+/g, ' ');
// Case-insensitive: several of these labels are upper-cased by CSS, which
// innerText reflects.
for (const probe of ['Profile', 'Connection to your system', 'Permitted to dispense', 'Open orders']) {
  if (!settings.toLowerCase().includes(probe.toLowerCase())) {
    bad.push(`settings page is missing "${probe}"`);
  }
}
console.log(`  settings: ${settings.slice(0, 150)}`);

await pharmacy.locator('button:has-text("Edit connection"), button:has-text("Connect")').first().click();
await pharmacy.waitForSelector('[role="dialog"]');
const dialog = (await pharmacy.locator('[role="dialog"]').innerText()).replace(/\s+/g, ' ');
console.log(`  connection dialog fields: ${(await pharmacy.locator('[role="dialog"] label').allInnerTexts()).map((t) => t.split('\n')[0].trim()).join(', ')}`);
if (!/never shown again/.test(dialog)) bad.push('the connection dialog does not say the password is write-only');
const pw = pharmacy.locator('[role="dialog"] input[type="password"]');
console.log(`  password field present and masked: ${(await pw.count()) > 0}`);
await pharmacy.keyboard.press('Escape');

// ── Super Admin: stuck orders and reroute ──
const admin = await b.newPage();
admin.on('pageerror', (e) => bad.push(`admin: ${String(e).slice(0, 90)}`));
await signIn(admin, 'super@healthemr.test', 'Super!2026', '/super-admin');
await admin.goto(`${WEB}/super-admin/stuck`);
await admin.waitForFunction(
  () => document.querySelector('table tbody tr') || /Nothing stuck/.test(document.body.innerText),
);

const rows = await admin.locator('table tbody tr').count();
console.log(`\n  stuck orders: ${rows}`);
if (rows) {
  console.log(`  columns: ${(await admin.locator('table thead th').allInnerTexts()).filter(Boolean).join(' · ')}`);
  console.log(`  first: ${(await admin.locator('table tbody tr').first().innerText()).replace(/\s+/g, ' ').slice(0, 120)}`);

  await admin.locator('button:has-text("Send elsewhere")').first().click();
  await admin.waitForSelector('[role="dialog"]');
  await admin.waitForTimeout(900);

  const reroute = (await admin.locator('[role="dialog"]').innerText()).replace(/\s+/g, ' ');
  console.log(`  reroute dialog: ${reroute.slice(0, 200)}`);
  if (!/two parcels/.test(reroute)) bad.push('the reroute dialog does not warn about a duplicate parcel');

  const select = admin.locator('[role="dialog"] [role="combobox"]').first();
  await select.click();
  await admin.waitForSelector('[role="listbox"]');
  const options = (await admin.locator('[role="option"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  console.log(`  pharmacies offered: ${options.join(' | ')}`);
  if (!options.length) bad.push('the reroute select offered nothing');

  // Escape closes the dropdown. It must not also close the dialog and discard
  // what was typed into it.
  await admin.keyboard.press('Escape');
  await admin.waitForTimeout(400);
  const stillOpen = await admin.locator('[role="dialog"]').count();
  console.log(`  dialog survives closing the dropdown: ${stillOpen === 1}`);
  if (stillOpen !== 1) bad.push('dismissing the select also closed the dialog');

  const confirm = admin.locator('[role="dialog"] button:has-text("Reroute order")');
  console.log(`  confirm disabled before a choice and a reason: ${await confirm.isDisabled()}`);
  await admin.keyboard.press('Escape');
}

console.log(bad.length ? `\n  PROBLEMS: ${bad.join(' | ')}` : '\n  clean');
await b.close();
process.exit(bad.length ? 1 : 0);
