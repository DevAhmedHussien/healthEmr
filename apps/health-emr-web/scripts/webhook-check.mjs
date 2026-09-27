/**
 * Registering where a client business is told what happened.
 *
 * The assertions that matter are the two that protect the client: the bearer
 * token is never shown back, and an endpoint cannot be registered on plain
 * http — these bodies carry patient information.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

// A client's CRM, so "Test" has somewhere real to land.
const received = [];
const crm = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    received.push({ auth: req.headers.authorization, body: raw });
    res.writeHead(200);
    res.end('{"ok":true}');
  });
});
await new Promise((r) => crm.listen(4998, r));

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', 'super@healthemr.test');
  await page.fill('input[name="password"]', 'Super!2026');
  await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

  await page.goto(`${BASE}/super-admin/admins`);
  await page.waitForSelector('table tbody tr');
  await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.locator('table tbody tr').first().click();
  await page.waitForURL('**/super-admin/admins/*', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  console.log('\nOn the client account');
  const panel = page.locator('text=Event webhooks').first();
  ok('the account has a webhooks section', await panel.isVisible());

  await page.getByRole('button', { name: 'Add endpoint' }).click();
  await page.waitForSelector('[role="dialog"]');
  const dialog = page.locator('[role="dialog"]');

  console.log('\nRegistering one');
  await dialog.getByLabel('Name').fill('CRM (browser check)');
  await dialog.getByLabel('URL').fill('http://example.com/hook');
  await dialog.getByLabel('Bearer token').fill('check-token-123456');
  await dialog.getByRole('button', { name: 'Add endpoint' }).click();
  await page.waitForTimeout(900);
  ok(
    'plain http is refused, because these bodies carry patient information',
    /https/i.test(await dialog.innerText()),
  );

  await dialog.getByLabel('URL').fill('http://localhost:4998/hook');
  await dialog.getByRole('button', { name: 'Add endpoint' }).click();
  await page.waitForTimeout(1500);

  console.log('\nThe signing secret');
  const secretDialog = page.locator('[role="dialog"]');
  const secretText = await secretDialog.innerText().catch(() => '');
  ok('is shown once, with a warning that it will not be shown again', /once/i.test(secretText));
  ok('and it is a real secret', /whsec_/.test(secretText), (secretText.match(/whsec_\S+/) ?? [''])[0].slice(0, 16) + '…');
  await secretDialog.getByRole('button', { name: /copied/i }).click();
  await page.waitForTimeout(600);

  console.log('\nBack on the list');
  await page.waitForLoadState('networkidle');
  const body = await page.locator('body').innerText();
  ok('the endpoint is listed', body.includes('CRM (browser check)'));
  ok(
    'the bearer token is never shown back',
    !body.includes('check-token-123456'),
    'it belongs to the client; replacing it is the supported operation',
  );

  console.log('\nTesting it');
  await page.getByRole('button', { name: 'Test' }).first().click();
  await page.waitForTimeout(2000);
  ok('the test reaches the client endpoint', received.length > 0, `${received.length} received`);
  ok(
    'carrying the token that was registered',
    received[0]?.auth === 'Bearer check-token-123456',
    received[0]?.auth ?? '(none)',
  );
  ok(
    'and naming no patient',
    !/"masterId":"(?!TEST)/.test(received[0]?.body ?? ''),
    received[0]?.body ?? '',
  );

  console.log('\nRemoving it');
  await page.getByRole('button', { name: /^Remove CRM/ }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Remove' }).click();
  await page.waitForTimeout(1200);
  ok('it is gone', !(await page.locator('body').innerText()).includes('CRM (browser check)'));
} finally {
  await browser.close();
  crm.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
