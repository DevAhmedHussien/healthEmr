import { chromium } from 'playwright';
const PORT = process.argv[2] ?? '3000';
const WEB = `http://localhost:${PORT}`;
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const calls = [];
page.on('request', (r) => { if (r.url().includes('/api/bff/')) calls.push(r.url().split('/api/bff/')[1]); });
page.on('requestfailed', (r) => { if (r.url().includes('/api/bff/')) calls.push('CANCELLED ' + r.url().split('/api/bff/')[1]); });

await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('login')), page.click('button[type="submit"]')]);
await page.waitForTimeout(3000);

for (const tab of ['Visits', 'Patients', 'Prescriptions', 'Visits']) {
  calls.length = 0;
  await page.locator(`nav a:has-text("${tab}")`).first().click();
  await page.waitForTimeout(2600);
  const list = calls.filter((c) => !c.includes('unread-count'));
  console.log(`  click ${tab.padEnd(14)} ${list.length} BFF calls  ${list.map((c) => c.startsWith('CANCELLED') ? 'X' : '✓').join('')}`);
  list.forEach((c) => console.log(`      ${c}`));
}
await b.close();
