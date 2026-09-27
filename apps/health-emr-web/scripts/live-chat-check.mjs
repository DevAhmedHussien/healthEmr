/**
 * A message arriving while somebody is looking at the page.
 *
 * The thing under test is the absence of a reload. Two browser contexts, two
 * people, one conversation: one sends, and the other must see it appear without
 * the page being navigated or refreshed.
 *
 * Until this existed the gateway broadcast into an empty room — nothing in the
 * browser was listening, so a reply sat unseen until somebody reloaded.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const PATIENT_EMAIL = process.env.PATIENT_EMAIL ?? 'marta.6769320@example.test';
const PATIENT_PASSWORD = process.env.PATIENT_PASSWORD ?? 'Patient!2026';
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
  await page.waitForLoadState('networkidle');
  return { context, page };
};

try {
  // A real pair on one conversation: the patient in their portal, the clinician
  // in theirs. The patient's login is set by `scripts/seed-test-patient-login.ts`
  // — patients are created with an unusable password by design.
  const clinician = await signIn('dr.okafor@healthemr.test', 'Provider!2026', /clinic/);
  const patient = await signIn(PATIENT_EMAIL, PATIENT_PASSWORD, /portal/);

  console.log('\nThe socket');
  const ticket = await clinician.page.evaluate(() =>
    fetch('/api/bff/v1/chat/ticket', { method: 'POST' })
      .then((r) => r.json())
      .then((b) => Boolean(b?.ticket))
      .catch(() => false),
  );
  ok('the browser can get a socket ticket', ticket);

  await clinician.page.goto(`${BASE}/clinic/messages`);
  await clinician.page.waitForSelector('ul li button');
  await patient.page.goto(`${BASE}/portal/messages`);
  await patient.page.waitForSelector('ul li button');

  // The conversation they actually share, not whichever is top of each list.
  // A clinician holds several, and the seed data has two distinct patients
  // called Marta Oyelaran — opening "the first one" on each side put the two
  // of them in different rooms and made a working socket look broken.
  const threadIds = async (page) =>
    page.evaluate(() =>
      fetch('/api/bff/v1/chat/threads?limit=50')
        .then((r) => r.json())
        .then((body) => (body.data ?? body).map((thread) => thread.id)),
    );
  const mine = await threadIds(clinician.page);
  const theirs = await threadIds(patient.page);
  const shared = mine.find((id) => theirs.includes(id));
  ok('the two of them share a conversation', Boolean(shared), shared ?? 'none in common');
  if (!shared) throw new Error('no shared thread to test with');

  await clinician.page.click(`ul li button[data-thread-id="${shared}"]`);
  await patient.page.click(`ul li button[data-thread-id="${shared}"]`);
  await clinician.page.waitForLoadState('networkidle');
  await patient.page.waitForLoadState('networkidle');

  // Stamped on the document now. It survives only as long as this document
  // does, so if a reload happened at any point below it will be gone.
  await clinician.page.evaluate(() => {
    window.__liveCheck = true;
  });

  console.log('\nThe patient writes to their clinician');
  const fromPatient = `patient says ${Date.now()}`;
  await patient.page.getByPlaceholder('Write a secure message…').fill(fromPatient);
  await patient.page.getByRole('button', { name: 'Send', exact: true }).click();

  // No reload, no navigation on the clinician's side — just wait and look.
  await clinician.page.waitForTimeout(3500);
  ok(
    'the clinician sees it without reloading',
    (await clinician.page.locator('body').innerText()).includes(fromPatient),
    fromPatient,
  );

  console.log('\nAnd the clinician replies');
  const fromClinician = `clinician says ${Date.now()}`;
  await clinician.page.getByPlaceholder('Write a secure message…').fill(fromClinician);
  await clinician.page.getByRole('button', { name: 'Send', exact: true }).click();

  await patient.page.waitForTimeout(3500);
  ok(
    'the patient sees the reply without reloading',
    (await patient.page.locator('body').innerText()).includes(fromClinician),
    fromClinician,
  );

  console.log('\nThe page really was never reloaded');
  const stillSameDocument = await clinician.page.evaluate(() => Boolean(window.__liveCheck));
  // If the page had reloaded, the messages would have arrived anyway — by
  // refetching. This is what separates "live" from "eventually".
  ok('the clinician stayed on one document throughout', stillSameDocument);

  await patient.context.close();
  await clinician.context.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
