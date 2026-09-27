/**
 * Checks the parts of the interface that only exist at runtime: whether icons
 * actually rendered, and whether the shared dialog behaves like a dialog.
 *
 * A modal that does not trap focus, restore it, or lock the page behind it looks
 * finished in a screenshot and is unusable with a keyboard — none of which a
 * type checker or a 200 response can tell you.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3005';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
const bad = [];
page.on('pageerror', e => bad.push(String(e).slice(0, 100)));

// login page icons
await page.goto(`${WEB}/login`);
console.log(`  login: sign-in button has an icon = ${await page.locator('button[type="submit"] svg').count() > 0}`);
console.log(`         password eye present       = ${await page.locator('button[aria-label="Show password"] svg').count() > 0}`);

await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/super-admin');

const navIcons = await page.locator('nav a svg').count();
const navLinks = await page.locator('nav a').count();
console.log(`\n  sidebar: ${navIcons}/${navLinks} links carry an icon`);
console.log(`           sign out has one = ${await page.locator('nav button:has-text("Sign out") svg').count() > 0}`);

// the shared dialog
const pharmId = await page.evaluate(async () =>
  (await (await fetch('/api/bff/v1/super-admin/pharmacies/directory?pageSize=20')).json()).data
    .find(p => p.name === 'Apex Compounding Pharmacy').id);
await page.goto(`${WEB}/super-admin/pharmacies/${pharmId}`);

const archive = page.locator('button:has-text("Archive pharmacy")');
console.log(`\n  archive button has an icon = ${await archive.locator('svg').count() > 0}`);
await archive.click();
await page.waitForSelector('[role="dialog"]');

console.log(`  dialog: body scroll locked = ${await page.evaluate(() => document.body.style.overflow === 'hidden')}`);
console.log(`          focus starts inside = ${await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))}`);
console.log(`          has a close button  = ${await page.locator('[role="dialog"] button[aria-label="Close"]').count() > 0}`);
console.log(`          danger header       = ${await page.locator('[role="dialog"] h2').evaluate(el => getComputedStyle(el).color)}`);

// tab should cycle within the dialog, never reaching the page behind it
for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
console.log(`          focus still trapped = ${await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))}`);

await page.keyboard.press('Escape');
await page.waitForSelector('[role="dialog"]', { state: 'detached' });
console.log(`  escape closed it, scroll restored = ${await page.evaluate(() => document.body.style.overflow !== 'hidden')}`);
console.log(`  focus returned to the opener      = ${await page.evaluate(() => document.activeElement?.textContent?.includes('Archive'))}`);

// edit uses the same shell. Exact, not `has-text`: the pharmacy page now carries
// an editable catalogue, so "Edit category" and "Edit connection" both match a
// substring and the first one in the DOM wins.
await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
await page.waitForSelector('[role="dialog"]');
const editTitle = await page.locator('[role="dialog"] h2').innerText();
console.log(`\n  edit opens the same dialog: "${editTitle}"`);
console.log(`     save disabled until a change = ${await page.locator('[role="dialog"] button:has-text("Save changes")').isDisabled()}`);
await page.fill('[role="dialog"] input >> nth=1', 'rx@apexcompounding.test');
console.log(`     after a change                = ${await page.locator('[role="dialog"] button:has-text("Save changes")').isDisabled() ? 'still disabled ✗' : 'enabled ✓'}`);
console.log(`     footer names what changed     = "${(await page.locator('[role="dialog"] p').last().innerText()).slice(0, 60)}"`);
await page.keyboard.press('Escape');

// ── adding a record opens a dialog, like every other add and edit ──
//
// This one used to be a panel that pushed the table down the page. The confirm
// button sits in the dialog footer, outside the <form>, so it submits via
// `form="…"` — worth asserting, because a broken wire there looks like a button
// that simply does nothing.
await page.goto(`${WEB}/super-admin/admins`);
await page.waitForFunction(
  () => (document.querySelector('table tbody tr')?.textContent ?? '').trim().length > 0,
);
await page.getByRole('button', { name: /add client account/i }).click();
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

const add = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const confirm = [...dialog.querySelectorAll('button')].find((b) =>
    /create and send invite/i.test(b.textContent ?? ''),
  );
  const form = dialog.querySelector('form');
  return {
    inputs: dialog.querySelectorAll('input').length,
    confirmOutsideForm: confirm ? !form?.contains(confirm) : null,
    wiredByFormAttr: confirm?.getAttribute('form') === form?.id && Boolean(form?.id),
  };
});
console.log(`\n  add client account opens a dialog: ${add.inputs} fields`);
console.log(`     confirm is in the footer, outside the form = ${add.confirmOutsideForm}`);
console.log(`     and wired to it by form= attribute         = ${add.wiredByFormAttr}`);

// Clicking it with nothing filled must surface validation, which only happens
// if the click actually reached the form.
await page.locator('[role="dialog"] button:has-text("Create and send invite")').click();
await page.waitForTimeout(600);
const complaints = await page.getByText(/is required/i).count();
console.log(`     empty submit is refused                    = ${complaints > 0}`);
await page.keyboard.press('Escape');
await page.waitForSelector('[role="dialog"]', { state: 'detached' });

// ── the sidebar marks exactly one item ──
console.log('\n  sidebar highlighting');
for (const path of ['/super-admin', '/super-admin/patients', '/super-admin/prescriptions',
                    '/super-admin/invoices', '/super-admin/activity', '/super-admin/admins']) {
  await page.goto(`${WEB}${path}`);
  await page.waitForSelector('nav a[aria-current="page"]');
  const on = (await page.locator('nav a[aria-current="page"]').allInnerTexts()).map((t) => t.trim());
  // A plain prefix test lights up the index item everywhere beneath it, which is
  // exactly the regression this guards.
  if (on.length !== 1) bad.push(`${path} highlighted ${on.length} nav items: ${on.join(', ')}`);
  console.log(`    ${on.length === 1 ? '✓' : '✗'} ${path.padEnd(30)} → ${on.join(' + ') || 'nothing'}`);
}

// ── the select is ours, not the operating system's ──
console.log('\n  select');
await page.goto(`${WEB}/super-admin/prescriptions`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);

const natives = await page.locator('select').count();
if (natives) bad.push(`${natives} native <select> elements remain`);
console.log(`    native <select> remaining: ${natives}`);

await page.locator('button', { hasText: /^Filters?/ }).first().click();
await page.waitForTimeout(400);
const statusTrigger = page.locator('[role="combobox"]').filter({ hasText: /Any/ }).first();
await statusTrigger.click();
await page.waitForSelector('[role="listbox"]');
const options = (await page.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
console.log(`    options: ${options.join(', ')}`);
if (!options.includes('shipped')) bad.push('status filter is missing prescription statuses');

await page.locator('[role="option"]', { hasText: 'shipped' }).first().click();
await page.waitForTimeout(900);
const search = new URL(page.url()).search;
console.log(`    choosing one writes the URL: ${search}`);
if (!search.includes('status=SHIPPED')) bad.push('choosing a filter did not reach the URL');
if (await page.locator('main').innerText().then((t) => t.includes('Try again'))) {
  bad.push('the filtered request failed');
}

// ── the top bar carries identity, the way the source design does ──
console.log('\n  top bar');
await page.goto(`${WEB}/super-admin`);
await page.waitForSelector('header');

const bell = page.locator('header button[aria-label^="Notifications"]');
const bellIcons = await bell.locator('svg').count();
console.log(`    bell: ${bellIcons} icon inside the button`);
// The badge once held a second copy of the icon instead of the unread count.
if (bellIcons !== 1) bad.push(`the bell has ${bellIcons} icons, expected 1`);

const sidebar = await page.locator('nav').innerText();
if (sidebar.includes('super@healthemr.test')) bad.push('the sidebar still carries the user block');

const menu = page.locator('header button[aria-haspopup="menu"]');
console.log(`    user button: "${(await menu.innerText()).replace(/\n/g, ' · ')}"`);
await menu.click();
await page.waitForSelector('[role="menu"]');
const items = (await page.locator('[role="menuitem"]').allInnerTexts()).map((t) => t.trim());
console.log(`    menu: ${items.join(', ')}`);
if (!items.some((item) => /details/i.test(item))) bad.push('no way to reach your own details');
if (!items.some((item) => /sign out/i.test(item))) bad.push('no way to sign out');

await page.locator('[role="menuitem"]', { hasText: 'My details' }).click();
await page.waitForURL('**/profile');
const profile = (await page.locator('main').innerText()).toLowerCase();
for (const probe of ['name', 'email', 'role', 'organisation', 'member since']) {
  if (!profile.includes(probe)) bad.push(`the profile page is missing ${probe}`);
}
console.log(`    profile reachable: ${profile.includes('my details')}`);

console.log(bad.length ? `\n  ERRORS: ${bad.join(' | ')}` : '\n  no page errors');
await b.close();
process.exit(bad.length ? 1 : 0);
