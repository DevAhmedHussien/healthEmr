/**
 * Setting the states a pharmacy ships into, from both seats.
 *
 * Routing excludes a pharmacy that cannot serve the patient's state, so this
 * field decides where orders can go. Two roles may set it — the platform
 * operator for any pharmacy, and a pharmacy for itself — and both go through
 * the same picker, because the failure this replaces was a free-text box where
 * `TX`, `Tx ` and `texas` all looked fine while typing.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const signIn = async (email, password, lands) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL(lands), page.click('button[type="submit"]')]);
  return { context, page };
};

const statesOf = (page, path) =>
  page.evaluate(
    (target) => fetch(`/api/bff/${target}`).then((r) => r.json()).then((b) => b.statesServed),
    path,
  );

try {
  console.log('\nThe operator, on any pharmacy');
  const { context: adminCtx, page: admin } = await signIn(
    'super@healthemr.test',
    'Super!2026',
    /super-admin/,
  );

  const id = await admin.evaluate(() =>
    fetch('/api/bff/v1/super-admin/pharmacies/directory?pageSize=1')
      .then((r) => r.json())
      .then((b) => b.data[0].id),
  );
  const before = await statesOf(admin, `v1/super-admin/pharmacies/${id}`);

  await admin.goto(`${BASE}/super-admin/pharmacies/${id}`);
  await admin.getByRole('button', { name: 'Edit', exact: true }).first().click();

  const picker = admin.getByRole('group', { name: 'States served' });
  await picker.waitFor({ state: 'visible', timeout: 10_000 });
  ok('the operator is offered a picker, not a text box', await picker.isVisible());

  // Toggling one state is the whole interaction, and it must be the only thing
  // the dialog reports as changed.
  const wasOn = before.includes('WY');
  await picker.getByRole('button', { name: 'WY', exact: true }).click();
  ok(
    'only the states field is reported as changed',
    (await admin.locator('text=/1 changed: States served/').count()) > 0,
  );

  await admin.getByRole('button', { name: /save changes/i }).click();
  await admin.waitForTimeout(1200);

  const after = await statesOf(admin, `v1/super-admin/pharmacies/${id}`);
  ok(
    wasOn ? 'removing a state persists' : 'adding a state persists',
    wasOn ? !after.includes('WY') : after.includes('WY'),
    `${before.length} → ${after.length} states`,
  );
  ok(
    'and nothing else in the list moved',
    after.filter((s) => s !== 'WY').sort().join() === before.filter((s) => s !== 'WY').sort().join(),
  );

  // Put it back the way it was found.
  await admin.evaluate(
    ({ target, states }) =>
      // Awaited inside the page: closing the context under an unresolved fetch
      // leaves the record however the test left it.
      fetch(`/api/bff/${target}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statesServed: states }),
      }).then((r) => r.ok),
    { target: `v1/super-admin/pharmacies/${id}`, states: before },
  );
  await adminCtx.close();

  console.log('\nA pharmacy, on itself');
  const { context: rxCtx, page: rx } = await signIn(
    'rx@firstchoice.test',
    'Pharmacy!2026',
    /dispensary/,
  );
  const mine = await statesOf(rx, 'v1/dispensary/profile');

  await rx.goto(`${BASE}/dispensary/settings`);
  await rx.getByRole('button', { name: /edit details|edit/i }).first().click();

  const ownPicker = rx.getByRole('group', { name: 'States you ship to' });
  // The dialog animates in; asking before it has arrived reads as "no picker".
  await ownPicker.waitFor({ state: 'visible', timeout: 10_000 });
  ok('the pharmacy gets the same picker', await ownPicker.isVisible());

  const target = mine.includes('VT') ? 'VT' : 'VT';
  const had = mine.includes(target);
  await ownPicker.getByRole('button', { name: target, exact: true }).click();
  await rx.getByRole('button', { name: /save/i }).last().click();
  await rx.waitForTimeout(1200);

  const mineAfter = await statesOf(rx, 'v1/dispensary/profile');
  ok(
    'a pharmacy can change its own states',
    had ? !mineAfter.includes(target) : mineAfter.includes(target),
    `${mine.length} → ${mineAfter.length} states`,
  );

  await rx.evaluate(
    (states) =>
      fetch('/api/bff/v1/dispensary/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statesServed: states }),
      }).then((r) => r.ok),
    mine,
  );
  await rxCtx.close();
  console.log('\nThe operator, on a clinician');
  const { context: opCtx, page: op } = await signIn(
    'super@healthemr.test',
    'Super!2026',
    /super-admin/,
  );
  // Somebody who is not already licensed everywhere, or there is no state to add.
  const provider = await op.evaluate(() =>
    fetch('/api/bff/v1/super-admin/providers?pageSize=50')
      .then((r) => r.json())
      .then((b) => b.data.find((row) => row.licensedStates.length < 51)),
  );
  ok('found a clinician with room for another state', Boolean(provider), provider?.name);

  await op.goto(`${BASE}/super-admin/providers/${provider.id}`);
  await op.getByRole('button', { name: /add a state/i }).click();
  const dialog = op.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });

  const held = await op.evaluate(
    (id) =>
      fetch(`/api/bff/v1/super-admin/providers/${id}/licences`)
        .then((r) => r.json())
        .then((b) => b.data.map((l) => l.state)),
    provider.id,
  );
  const free = ['WY', 'VT', 'ND', 'SD', 'MT', 'AK', 'HI'].find((s) => !held.includes(s));

  await dialog.getByLabel('State').click();
  await op.getByRole('option', { name: free, exact: true }).click();
  await dialog.getByLabel('Licence number').fill('E2E-LICENCE-1');
  await dialog
    .getByLabel('Expires')
    .fill(new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10));
  await op.getByRole('button', { name: /add licence/i }).click();
  await op.waitForTimeout(1500);

  const afterAdd = await op.evaluate(
    (id) =>
      fetch(`/api/bff/v1/super-admin/providers/${id}/licences`)
        .then((r) => r.json())
        .then((b) => b.data),
    provider.id,
  );
  const added = afterAdd.find((l) => l.state === free);
  ok('the operator can add a state to a clinician', Boolean(added), `${free} added`);
  ok(
    'and it is live, because the platform is who credentials people',
    added?.status === 'ACTIVE',
    added?.status,
  );

  await op.evaluate(
    ({ id, licenceId }) =>
      fetch(`/api/bff/v1/super-admin/providers/${id}/licences/${licenceId}`, {
        method: 'DELETE',
      }).then((r) => r.ok),
    { id: provider.id, licenceId: added.id },
  );
  await opCtx.close();

  console.log('\nA clinician, on themselves');
  const { context: drCtx, page: dr } = await signIn(
    'dr.okafor@healthemr.test',
    'Provider!2026',
    /clinic/,
  );
  await dr.goto(`${BASE}/clinic/licences`);
  const mineStates = await dr.evaluate(() =>
    fetch('/api/bff/v1/clinic/me/licences')
      .then((r) => r.json())
      .then((b) => b.data.map((l) => l.state)),
  );
  const freeForMe = ['WY', 'VT', 'ND', 'SD', 'MT'].find((s) => !mineStates.includes(s));

  await dr.getByRole('button', { name: /add a state/i }).click();
  const own = dr.getByRole('dialog');
  await own.waitFor({ state: 'visible', timeout: 10_000 });
  await own.getByLabel('State').click();
  await dr.getByRole('option', { name: freeForMe, exact: true }).click();
  await own.getByLabel('Licence number').fill('SELF-E2E-1');
  await own
    .getByLabel('Expires')
    .fill(new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10));
  await dr.getByRole('button', { name: /add licence/i }).click();
  await dr.waitForTimeout(1500);

  const mineAfterAdd = await dr.evaluate(() =>
    fetch('/api/bff/v1/clinic/me/licences')
      .then((r) => r.json())
      .then((b) => b.data),
  );
  const self = mineAfterAdd.find((l) => l.state === freeForMe);
  ok('a clinician can add a state themselves', Boolean(self), `${freeForMe} added`);
  // The one that matters: it must not be usable until somebody checks it.
  ok(
    'but it cannot route visits until the platform checks it',
    self?.status === 'PENDING',
    self?.status,
  );
  await drCtx.close();

  // Remove what this run added.
  const { context: cleanCtx, page: clean } = await signIn(
    'super@healthemr.test',
    'Super!2026',
    /super-admin/,
  );
  const okafor = await clean.evaluate(() =>
    fetch('/api/bff/v1/super-admin/providers?pageSize=50')
      .then((r) => r.json())
      .then((b) => b.data.find((row) => /okafor/i.test(row.name))),
  );
  await clean.evaluate(
    ({ id, licenceId }) =>
      fetch(`/api/bff/v1/super-admin/providers/${id}/licences/${licenceId}`, {
        method: 'DELETE',
      }).then((r) => r.ok),
    { id: okafor.id, licenceId: self.id },
  );
  await cleanCtx.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
