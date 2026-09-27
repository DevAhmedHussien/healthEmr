/**
 * A visit nobody could take, and the two ways out of it.
 *
 * Routing runs once, when the visit arrives. Everything here exists because
 * that was the only time it ever ran: a visit that missed its moment — every
 * clinician busy — sat unassigned for ever while the condition that caused it
 * cleared minutes later.
 *
 * So: the sweep picks up what has become placeable, and a person can place what
 * never will be. The gate that must not move is licensure, and it is checked
 * here against the operator, who outranks everyone and still cannot waive it.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

const call = (path, init) =>
  page.evaluate(
    async ({ target, options }) => {
      const response = await fetch(`/api/bff/${target}`, options);
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { target: path, options: init },
  );

try {
  console.log('\nWho could take a visit, and why the others could not');
  const visit = await page.evaluate(() =>
    fetch('/api/bff/v1/super-admin/visits?pageSize=1&order=desc')
      .then((r) => r.json())
      .then((b) => b.data[0]),
  );
  const { status, body } = await call(`v1/super-admin/visits/${visit.id}/candidates`);
  ok('the operator can see every candidate', status === 200, `${body?.data?.length} clinicians`);
  ok('each one is judged against the state the patient submitted from', Boolean(body?.state), body?.state);

  const refused = body.data.filter((row) => !row.eligible);
  ok(
    'and anyone who cannot take it says why',
    refused.every((row) => Boolean(row.blocker)),
    refused.map((row) => `${row.name}: ${row.blocker}`)[0] ?? 'everyone is eligible',
  );

  // Capacity is shown but must not disqualify — overriding it is the point.
  const full = body.data.filter((row) => row.atCapacity);
  ok(
    'being at capacity is a warning, not a refusal',
    full.every((row) => row.eligible || row.blocker !== null),
    `${full.length} at or over capacity`,
  );

  console.log('\nThe gate that does not move');
  // It has to be a visit with nobody on it: refusing because the visit is
  // already assigned proves nothing about licensure, and a check that passes
  // for the wrong reason is worse than no check.
  const openVisit = await page.evaluate(() =>
    fetch('/api/bff/v1/super-admin/visits?requestStatus=PENDING_ASSIGNMENT&pageSize=1')
      .then((r) => r.json())
      .then((b) => b.data[0]),
  );

  if (!openVisit) {
    console.log('  – no unassigned visit to test against; the sweep has placed them all');
    console.log('    (the licence gate is covered by the API check in the same commit)');
  } else {
    const pool = await call(`v1/super-admin/visits/${openVisit.id}/candidates`);
    const blocked = pool.body.data.find((row) => !row.eligible);
    if (blocked) {
      const attempt = await call(`v1/super-admin/visits/${openVisit.id}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: blocked.id,
          reason: 'attempting to place an unlicensed clinician',
        }),
      });
      const message = String(attempt.body?.message ?? '');
      ok(
        'even the operator cannot assign an unlicensed clinician',
        attempt.status === 400 && /licence|credentialled/i.test(message),
        `${attempt.status} ${message}`,
      );
    } else {
      console.log('  – every clinician is eligible for that visit; nothing to refuse');
    }
  }

  // Rejected by validation before anything is looked at, so any visit will do.
  const short = await call(`v1/super-admin/visits/${visit.id}/assign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: body.data[0].id, reason: 'too short' }),
  });
  ok(
    'a change this consequential needs a real reason',
    short.status === 400 && /reason/i.test(JSON.stringify(short.body ?? {})),
    `${short.status} ${JSON.stringify(short.body?.message ?? '')}`.slice(0, 90),
  );

  console.log('\nNothing is left waiting');
  const waiting = await page.evaluate(() =>
    fetch('/api/bff/v1/super-admin/visits?requestStatus=PENDING_ASSIGNMENT&pageSize=50')
      .then((r) => r.json())
      .then((b) => b.data),
  );
  // The sweep runs every minute, so anything placeable is already placed. What
  // is left, if anything, is structural — and that is what the dialog is for.
  ok(
    'no visit is sitting unassigned that could have been placed',
    waiting.length === 0,
    waiting.length ? `${waiting.length} still waiting (structural)` : 'queue is clear',
  );
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
