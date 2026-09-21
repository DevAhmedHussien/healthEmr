import { chromium } from 'playwright';
const WEB = 'http://localhost:3000';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1400, height: 1100 } });
const bad = [];
page.on('pageerror', (e) => bad.push(String(e).slice(0, 150)));
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });

const pick = async (combo, option) => {
  await combo.click();
  await page.waitForSelector('[role="listbox"]');
  await page.locator('[role="option"]', { hasText: option }).first().click();
  await page.waitForTimeout(250);
};

await page.goto(`${WEB}/form/weight-loss`);
await page.waitForSelector('input', { timeout: 30000 });
const stamp = Date.now().toString().slice(-7);
await page.getByLabel('First name').fill('Basket');
await page.getByLabel('Last name').fill(`Tester${stamp.slice(-4)}`);
await page.getByLabel('Date of birth').fill('04181990');
await pick(page.locator('[role="combobox"]').first(), 'Female');
await page.getByLabel('Mobile number').fill(`512777${stamp.slice(-4)}`);
await page.getByLabel('Email').fill(`basket.${stamp}@example.test`);
await page.getByLabel('Address').fill('19 Congress Ave');
await page.getByLabel('City').fill('Austin');
await pick(page.locator('[role="combobox"]').nth(1), 'TX');
await page.getByLabel('ZIP').fill('73301');
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/Allergies/');
const areas = page.locator('textarea');
for (let i = 0; i < await areas.count(); i += 1) await areas.nth(i).fill('None');
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('main h2');
for (let pass = 0; pass < 8; pass += 1) {
  if (!(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled())) break;
  const combos = page.locator('main [role="combobox"]');
  for (let i = 0; i < await combos.count(); i += 1) {
    const c = combos.nth(i);
    if (!/Choose|Any|^$/.test((await c.innerText()).trim())) continue;
    await c.click(); await page.waitForSelector('[role="listbox"]');
    const opts = page.locator('[role="option"]');
    for (let j = 0; j < await opts.count(); j += 1) {
      if (/do not wish/i.test((await opts.nth(j).innerText()))) continue;
      await opts.nth(j).click(); break;
    }
    await page.waitForTimeout(200);
  }
  const inputs = page.locator('main input[type="text"], main input:not([type]), main input[inputmode="numeric"]');
  for (let i = 0; i < await inputs.count(); i += 1) {
    const el = inputs.nth(i);
    if ((await el.inputValue()).trim()) continue;
    const label = (await el.evaluate((n) => n.closest('label')?.innerText ?? '')).toLowerCase();
    await el.fill(/height/.test(label) ? `5'7"` : /weight/.test(label) ? '205' : 'None');
  }
  for (const a of await page.locator('main textarea').all()) if (!(await a.inputValue()).trim()) await a.fill('None');
  await page.waitForTimeout(400);
}
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/Treatment you are asking about/');
console.log('=== Treatment step');
// Add two medications with prices.
for (const price of ['299.00', '45.00']) {
  await page.locator('label:has-text("Treatment you are asking about") [role="combobox"]').click();
  await page.waitForSelector('[role="listbox"]');
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(400);
  const boxes = page.locator('input[aria-label^="What you paid"]');
  await boxes.nth(await boxes.count() - 1).fill(price);
  await page.waitForTimeout(200);
}
console.log('basket lines:', await page.locator('input[aria-label^="What you paid"]').count());
await page.screenshot({ path: '/tmp/basket.png', clip: { x: 0, y: 150, width: 1400, height: 620 } });
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/photo of your ID/');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAE0lEQVR4nGP8//8/AzbAxIAdDGYJAGkGAwMSbjXvAAAAAElFTkSuQmCC', 'base64');
await page.setInputFiles('input[type="file"]', { name: 'licence.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Continue', exact: true }).click();

await page.waitForSelector('text=/Check this over/');
console.log('review says:', (await page.locator('main').innerText()).match(/Asking about[^\n]*/)?.[0]);
await page.locator('input[type="checkbox"]').check();
await page.locator('button:has-text("Submit to a clinician")').click();
await page.waitForSelector('text=/with a clinician now/', { timeout: 30000 }).catch(() => {});
const ref = (await page.locator('main').innerText()).match(/reference is ([0-9a-f]{8})/)?.[1];
console.log('submitted:', ref ?? 'FAILED');
console.log('errors:', [...new Set(bad)].join(' | ') || 'none');
await b.close();
