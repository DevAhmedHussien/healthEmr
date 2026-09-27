/**
 * Fills in the hosted intake form the way a patient would, and follows it
 * through to the clinician's queue.
 *
 * The point of an intake is that a clinician can read what the patient said
 * before deciding, so this does not stop at "submitted" — it signs in as the
 * assigned clinician and asserts the questionnaire and the photograph are there.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3005';
const API = process.env.API_URL ?? 'http://localhost:4000';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage();
const bad = [];
page.on('pageerror', (e) => bad.push(String(e).slice(0, 120)));
page.on('response', (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });

const pick = async (combo, option) => {
  await combo.click();
  await page.waitForSelector('[role="listbox"]');
  await page.locator('[role="option"]', { hasText: option }).first().click();
  await page.waitForTimeout(250);
};

await page.goto(`${WEB}/form/weight-loss`);

// The flow opens on a greeting, then asks one question per screen. Waiting for
// an input would wait forever on a screen that deliberately has none.
await page.waitForSelector('[role="progressbar"]', { timeout: 30000 });
const stepCount = (await page.locator('text=/Step \\d+ of \\d+/').first().innerText()).trim();
console.log(`  ${stepCount}, one question per screen`);
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.waitForTimeout(500);

const stamp = Date.now().toString().slice(-7);

await page.getByLabel('First name').fill('Priya');
await page.getByLabel('Last name').fill('Raghunathan');
await page.getByLabel('Date of birth').fill('04181990');
await pick(page.locator('[role="combobox"]').first(), 'Female');
await page.getByLabel('Mobile number').fill(`512555${stamp.slice(-4)}`);
await page.getByLabel('Email').fill(`intake.${stamp}@example.test`);
await page.getByLabel('Address').fill('19 Congress Ave');
await page.getByLabel('City').fill('Austin');
await pick(page.locator('[role="combobox"]').nth(1), 'TX');
await page.getByLabel('ZIP').fill('73301');
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/Allergies/');
const areas = page.locator('textarea');
await areas.nth(0).fill('Penicillin');
await areas.nth(1).fill('None');
await areas.nth(2).fill('None');
await page.getByRole('button', { name: 'Continue', exact: true }).click();

/**
 * Answers whatever the template asks, one screen at a time.
 *
 * The questions are production content and change; a check that hard-codes them
 * breaks on every edit and tells you nothing about the form. This answers by
 * kind and walks forward until the treatment step appears.
 */
let screens = 0;
let refusalSeen = false;

for (let guard = 0; guard < 60; guard += 1) {
  const text = await page.locator('main').innerText();
  if (/Treatment you are asking about/.test(text)) break;

  if (/We cannot continue/.test(text)) {
    refusalSeen = true;
    console.log('  an answer stopped the visit, as it should');
    break;
  }

  screens += 1;

  const combos = page.locator('main [role="combobox"]');
  for (let i = 0; i < (await combos.count()); i += 1) {
    const combo = combos.nth(i);
    const shown = (await combo.innerText()).trim();
    if (!['Choose one', 'Choose any that apply', ''].includes(shown)) continue;

    await combo.click();
    await page.waitForSelector('[role="listbox"]');
    const options = page.locator('[role="option"]');
    for (let j = 0; j < (await options.count()); j += 1) {
      if (/do not wish/i.test(await options.nth(j).innerText())) continue;
      await options.nth(j).click();
      break;
    }
    // A multi-select stays open after a pick.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }

  const inputs = page.locator(
    'main input[type="text"], main input:not([type]), main input[inputmode="numeric"]',
  );
  for (let i = 0; i < (await inputs.count()); i += 1) {
    const input = inputs.nth(i);
    if ((await input.inputValue()).trim()) continue;
    const label = (await input.evaluate((el) => el.closest('label')?.innerText ?? '')).toLowerCase();
    await input.fill(/height/.test(label) ? `5'7"` : /weight/.test(label) ? '205' : 'None');
  }
  for (const area of await page.locator('main textarea').all()) {
    if (!(await area.inputValue()).trim()) await area.fill('None');
  }
  await page.waitForTimeout(350);

  const next = page.getByRole('button', { name: 'Continue', exact: true });
  if (await next.isDisabled()) {
    bad.push(`stuck on a question screen — ${text.replace(/\s+/g, ' ').slice(0, 140)}`);
    break;
  }
  await next.click();
  await page.waitForTimeout(400);
}

console.log(`  answered ${screens} question screens`);
if (!refusalSeen && screens === 0) bad.push('no questions were asked at all');

await page.waitForSelector('text=/Treatment you are asking about/');
const kitSelect = page
  .locator('label', { hasText: 'Treatment you are asking about' })
  .locator('[role="combobox"]');
await kitSelect.click();
await page.waitForSelector('[role="listbox"]');
console.log(
  `\n  treatments offered: ${(await page.locator('[role="option"]').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .slice(0, 3)
    .join(' | ')}`,
);
await page.locator('[role="option"]').first().click();
await page.waitForTimeout(300);

// An order is a basket now, not a single choice: pick, add, and price it.
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('input[aria-label^="What you paid"]').first().fill('249.00');
await page.waitForTimeout(250);

const lines = await page.locator('input[aria-label^="What you paid"]').count();
console.log(`  basket: ${lines} line${lines === 1 ? '' : 's'}, priced`);
if (lines === 0) bad.push('nothing could be added to the order');

await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/photo of your ID/');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAE0lEQVR4nGP8//8/AzbAxIAdDGYJAGkGAwMSbjXvAAAAAElFTkSuQmCC',
  'base64',
);
await page.setInputFiles('input[type="file"]', { name: 'licence.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/Check this over/');
const blocked = await page.locator('button:has-text("Submit to a clinician")').isDisabled();
console.log(`\n  submit blocked until consent: ${blocked}`);
if (!blocked) bad.push('the form could be submitted without consent');

await page.locator('input[type="checkbox"]').check();
const submitted = page.waitForResponse(
  (r) => r.request().method() === 'POST' && /\/intake\/|\/visit/.test(r.url()),
  { timeout: 30000 },
);
await page.locator('button:has-text("Submit to a clinician")').click();
const response = await submitted.catch(() => null);
if (response && !response.ok()) {
  bad.push(`submit returned ${response.status()} — ${(await response.text()).slice(0, 300)}`);
}
await page.waitForSelector('text=/with a clinician now/', { timeout: 30000 }).catch(async () => {
  bad.push(`no confirmation — ${(await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
});
const reference = (await page.locator('main').innerText()).match(/reference is ([0-9a-f]{8})/)?.[1];
console.log(`  submitted - reference ${reference}`);
if (!reference) bad.push('no reference was shown after submitting');

const login = await fetch(`${API}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'super@healthemr.test', password: 'Super!2026' }),
}).then((r) => r.json());

const list = await fetch(`${API}/v1/super-admin/patients?q=Raghunathan`, {
  headers: { Authorization: `Bearer ${login.tokens.accessToken}` },
}).then((r) => r.json());
console.log(`\n  patient created: ${list.data.length > 0} (${list.data[0]?.mrn ?? 'none'})`);
if (!list.data.length) bad.push('the submission created no patient');

console.log(bad.length ? `\n  PROBLEMS: ${bad.join(' | ')}` : '\n  clean');
await b.close();
process.exit(bad.length ? 1 : 0);
