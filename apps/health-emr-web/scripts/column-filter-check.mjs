/**
 * The filter box under each column header.
 *
 * Filtering is done by the server, so the assertion that matters is that typing
 * in a box changes which rows come back — not merely which of the rows already
 * on screen are shown. A client-side filter would pass a naive test and quietly
 * search one page of a much larger set.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([page.waitForURL(/super-admin/), page.click('button[type="submit"]')]);

await page.goto(`${BASE}/super-admin/visits`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForLoadState('networkidle');

const searchToggle = () => page.getByRole('button', { name: /column search|Search each column/i });

/** The strip is a disclosure; open it if it is not already showing. */
async function openFilters() {
  if (await page.locator('tr.ar-filter-row').count()) return;
  await searchToggle().first().click();
  await page.waitForSelector('tr.ar-filter-row');
}

const rowCount = () => page.locator('table tbody tr').count();

/**
 * Typing is debounced by 300ms before it becomes a request, so waiting on the
 * network alone passes instantly — before the request being waited for has even
 * been made. A fixed delay past the debounce works until the machine is busy
 * and then fails for no reason, so where there is a condition to wait on, wait
 * on it.
 */
async function settle() {
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle');
}

/**
 * Fills a box, waits for its parameter to reach the URL, and waits for the
 * table to finish redrawing.
 *
 * The last part matters: a query nobody has run before draws eight skeleton
 * rows, and counting rows while they are on screen reports eight results for a
 * search that actually matched nothing.
 */
async function typeFilter(box, key, value) {
  await box.fill(value);
  const present = Boolean(value);
  await page
    .waitForFunction(
      ([k, want]) => new URL(location.href).searchParams.has(k) === want,
      [key, present],
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForLoadState('networkidle');
  await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => {});
}

console.log('\nThe column search is a disclosure of its own');
ok('it is closed to begin with', (await page.locator('tr.ar-filter-row').count()) === 0);

const toggle = searchToggle().first();
ok('a search icon offers it', await toggle.isVisible());

await toggle.click();
await page.waitForSelector('tr.ar-filter-row');
ok('clicking opens the strip', (await page.locator('tr.ar-filter-row').count()) === 1);
ok('and says so to a screen reader', (await toggle.getAttribute('aria-expanded')) === 'true');
ok(
  'the icon now offers to put it away',
  /hide/i.test((await toggle.getAttribute('aria-label')) ?? ''),
  (await toggle.getAttribute('aria-label')) ?? '',
);

await toggle.click();
await page.waitForTimeout(200);
ok('clicking again collapses it', (await page.locator('tr.ar-filter-row').count()) === 0);

console.log('\nThe Filters panel is separate');
const filterButton = page.locator('button', { hasText: /^Filters?/ }).first();
await filterButton.click();
await page.waitForTimeout(250);
ok(
  'opening the panel does not open the column strip',
  (await page.locator('tr.ar-filter-row').count()) === 0,
);
await filterButton.click();
await page.waitForTimeout(150);

await openFilters();

console.log('\nA filter box under each column');
const boxes = page.locator('tr.ar-filter-row input, tr.ar-filter-row button');
ok('the header carries a filter strip', (await boxes.count()) > 0, `${await boxes.count()} controls`);

const before = await rowCount();
ok('rows are on screen to begin with', before > 0, `${before} rows`);

console.log('\nTyping in a column box');
const strip = page.locator('tr.ar-filter-row');
const patientBox = strip.getByLabel('Filter by Patient').first();
await typeFilter(patientBox, 'patient', 'zzzznotapatient');
// The table says "No results" rather than simply having fewer rows — and it
// distinguishes that from an empty dataset, which is the thing an operator
// needs to know.
const noResults = await page.getByText('No results', { exact: true }).count();
ok('a term that matches nothing says so', noResults === 1, `${await rowCount()} rows shown`);

ok('the filter is in the URL, so the view can be shared', page.url().includes('patient=zzzznotapatient'), page.url().split('?')[1] ?? '');

await typeFilter(patientBox, 'patient', '');
ok('clearing it brings the rows back', (await rowCount()) === before, `${await rowCount()} rows`);

console.log('\nArriving with a filter already applied');
await page.goto(`${BASE}/super-admin/visits?patient=a`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await page.waitForLoadState('networkidle');
ok(
  'a shared link opens the strip, so the filter is visible',
  (await page.locator('tr.ar-filter-row').count()) === 1,
);
await page.goto(`${BASE}/super-admin/visits`);
await page.waitForLoadState('networkidle');
await openFilters();

/**
 * A name column holds two fields joined for display.
 *
 * This check used to type a surname fragment, which matched the one field the
 * filter looked at — so it passed while typing a first name, or the whole name
 * as it appears in the cell, found nothing at all.
 */
console.log('\nSearching a name the way it is displayed');
await page.goto(`${BASE}/super-admin/patients`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await openFilters();

// Taken from the API through the page's own session rather than scraped out of
// a cell: column order shifts with the selection checkbox and hidden columns,
// and a check that silently reads the wrong cell reports success on nonsense.
const shown = await page.evaluate(() =>
  fetch('/api/bff/v1/super-admin/patients?pageSize=1')
    .then((r) => r.json())
    .then((b) => b.data[0]?.name ?? ''),
);
const [firstWord, ...restWords] = shown.split(/\s+/);
const surname = restWords.join(' ');
ok('a patient with a two-part name to search for', Boolean(firstWord && surname), shown);

const nameBox = page.locator('tr.ar-filter-row').getByLabel('Filter by Patient').first();

for (const [label, term] of [
  ['a surname', surname],
  ['a first name', firstWord],
  ['the whole name, as the cell shows it', shown],
  ['the words the other way round', `${surname} ${firstWord}`],
]) {
  await typeFilter(nameBox, 'lastName', term);
  const found = await page.locator('table tbody tr').count();
  const empty = await page.getByText('No results', { exact: true }).count();
  ok(`${label} finds somebody — "${term}"`, empty === 0 && found > 0, `${found} rows`);
}

await typeFilter(nameBox, 'lastName', '');

// Back to the visits table, which the remaining steps are written against.
await page.goto(`${BASE}/super-admin/visits`);
await page.waitForSelector('table tbody tr');
await page.locator('.ar-skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await openFilters();

console.log('\nThe server is doing the filtering');
// A page holds 25 rows; if the whole set is larger and a filter returns more
// than one page, the browser cannot have done it from what it had.
const requests = [];
page.on('request', (request) => {
  if (request.url().includes('/api/bff/')) requests.push(request.url());
});
await typeFilter(strip.getByLabel('Filter by Email').first(), 'email', 'example');
ok('typing issues a request', requests.some((url) => url.includes('email=example')), `${requests.length} requests`);

console.log('\nTwo boxes at once');
await typeFilter(strip.getByLabel('Filter by Patient').first(), 'patient', 'a');
const url = new URL(page.url());
ok(
  'both filters survive in the URL',
  url.searchParams.get('email') === 'example' && url.searchParams.get('patient') === 'a',
  url.search,
);

console.log('\nClearing everything');
await page.getByRole('button', { name: 'Clear' }).click();
await settle();
await openFilters();
ok(
  'the clear button empties every box',
  !page.url().includes('patient=') && !page.url().includes('email='),
  page.url(),
);
ok('and the rows come back', (await rowCount()) === before, `${await rowCount()} rows`);

console.log('\nAccessibility');
const unlabelled = await page.locator('tr.ar-filter-row input:not([aria-label])').count();
ok('every filter box names its column', unlabelled === 0, `${unlabelled} unlabelled`);

const errors = [];
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
await page.reload();
await page.waitForLoadState('networkidle');
ok('no console errors', errors.length === 0, errors[0] ?? '');

/**
 * Every table in the console.
 *
 * Each is a different endpoint with its own allowlist, and a key that does not
 * match one is refused with a 400 — so a page whose filter keys have drifted
 * from its service shows an error rather than an unfiltered table. Walking them
 * all is what catches that.
 */
console.log('\nEvery table filters without error');
const TABLES = [
  ['/super-admin/visits', 'super admin · visits'],
  ['/super-admin/prescriptions', 'super admin · prescriptions'],
  ['/super-admin/patients', 'super admin · patients'],
  ['/super-admin/providers', 'super admin · providers'],
  ['/super-admin/pharmacies', 'super admin · pharmacies'],
  ['/super-admin/admins', 'super admin · accounts'],
  ['/super-admin/invoices', 'super admin · invoices'],
  ['/super-admin/activity', 'super admin · activity'],
  ['/super-admin/medications', 'super admin · catalogue'],
  ['/super-admin/applications', 'super admin · applications'],
];

for (const [path, label] of TABLES) {
  const refused = [];
  const onResponse = (response) => {
    if (response.url().includes('/api/bff/') && response.status() >= 400) {
      refused.push(`${response.status()} ${response.url().split('/api/bff/')[1]}`);
    }
  };
  page.on('response', onResponse);

  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await openFilters();

  const boxes = page.locator('tr.ar-filter-row input[type="search"]');
  const count = await boxes.count();

  if (count === 0) {
    ok(label, false, 'no filter boxes');
    page.off('response', onResponse);
    continue;
  }

  // Type into every text box at once: a term that matches nothing, so the only
  // thing under test is whether the endpoint accepts the parameters.
  for (let index = 0; index < count; index += 1) {
    await boxes.nth(index).fill('zqx');
  }
  await settle();

  ok(label, refused.length === 0, refused[0] ?? `${count} columns filterable`);

  // And that no column was left out. Every header should offer either a control
  // or the dash that says why it cannot — a silently blank cell is the bug this
  // catches, and the reason the strip is worth checking column by column.
  const coverage = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table thead tr')];
    const labels = [...(rows[0]?.children ?? [])].map((cell) =>
      (cell.textContent || '').replace(/[\u25bc\u25b2]/g, '').trim(),
    );
    const strip = rows.find((row) => row.classList.contains('ar-filter-row'));
    const bare = [...(strip?.children ?? [])]
      // A select renders as a button, not a `select`, so ask for anything
      // interactive; `[aria-hidden]` is the explained dash.
      .map((cell, index) =>
        cell.querySelector('input, select, button, [role="combobox"], [aria-hidden]')
          ? null
          : labels[index],
      )
      .filter((name) => name);
    return { columns: labels.length, bare };
  });
  ok(
    `${label} — every column accounted for`,
    coverage.bare.length === 0,
    coverage.bare.length ? `nothing under: ${coverage.bare.join(', ')}` : `${coverage.columns} columns`,
  );

  page.off('response', onResponse);
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
