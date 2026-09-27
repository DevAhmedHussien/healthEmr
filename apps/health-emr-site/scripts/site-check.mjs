/**
 * The public site, in a real browser.
 *
 * A marketing site fails differently to an app: nothing throws, the page just
 * quietly reads badly — a heading that wraps to five lines on a phone, a form
 * whose labels are not attached to anything, a page that scrolls sideways. So
 * this checks the things that are invisible from a 200.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3006';
const PAGES = [
  '/', '/platform', '/for-telehealth', '/for-clinicians', '/for-pharmacies',
  '/security', '/apply/telehealth', '/apply/clinician', '/apply/pharmacy',
];

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const browser = await chromium.launch({ channel: 'chrome' });

try {
  console.log('\nEvery page, on a desktop');
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 100));
  });
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 100)));

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    const audit = await page.evaluate(() => {
      const h1s = document.querySelectorAll('h1');
      const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName);
      // A heading level skipped (h1 straight to h3) is the most common real
      // accessibility fault on a marketing page.
      let skipped = false;
      let previous = 1;
      for (const tag of headings) {
        const level = Number(tag[1]);
        if (level > previous + 1) skipped = true;
        previous = level;
      }
      return {
        h1: h1s.length,
        h1Text: h1s[0]?.textContent?.trim().slice(0, 40) ?? '',
        skipped,
        // Any image without alt text.
        imagesMissingAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        // Every SVG that carries meaning should name itself.
        svgsUnlabelled: [...document.querySelectorAll('svg[role="img"]')].filter(
          (s) => !s.getAttribute('aria-label'),
        ).length,
        title: document.title,
      };
    });
    ok(`${path} — one h1`, audit.h1 === 1, `“${audit.h1Text}”`);
    ok(`${path} — heading levels in order`, !audit.skipped);
    ok(`${path} — every image and diagram is labelled`,
      audit.imagesMissingAlt === 0 && audit.svgsUnlabelled === 0);
  }
  ok('no console errors anywhere', errors.length === 0, errors[0] ?? '');
  await desktop.close();

  console.log('\nOn a phone');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  for (const path of PAGES) {
    await small.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    const overflow = await small.evaluate(
      // 1px of slack: sub-pixel rounding on a scaled viewport is not a bug.
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
    );
    ok(`${path} — does not scroll sideways`, !overflow);
  }
  await phone.close();

  console.log('\nThe forms are usable');
  const formCtx = await browser.newContext();
  const form = await formCtx.newPage();
  for (const path of ['/apply/telehealth', '/apply/clinician', '/apply/pharmacy']) {
    await form.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    const audit = await form.evaluate(() => {
      const controls = [...document.querySelectorAll('input, select, textarea')];
      const unlabelled = controls.filter((control) => {
        if (control.type === 'hidden') return false;
        if (control.getAttribute('aria-label')) return false;
        if (control.id && document.querySelector(`label[for="${control.id}"]`)) return false;
        return !control.closest('label');
      });
      return {
        controls: controls.length,
        unlabelled: unlabelled.length,
        submits: document.querySelectorAll('button[type="submit"]').length,
      };
    });
    ok(`${path} — every field is labelled`, audit.unlabelled === 0, `${audit.controls} fields`);
    ok(`${path} — has exactly one submit`, audit.submits === 1);
  }
  await formCtx.close();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
