/**
 * The console, checked the way somebody who cannot use a mouse uses it.
 *
 * Every control reachable and named, every field labelled, headings in order,
 * text that passes contrast against the palette it sits on, and a dialog that
 * does not strand the keyboard behind it. These are the failures that never
 * show up in a screenshot and never get reported, because the people they stop
 * are the people who give up and go elsewhere.
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

const ROLES = [
  {
    email: 'super@healthemr.test',
    password: 'Super!2026',
    pages: ['/super-admin', '/super-admin/visits', '/super-admin/admins', '/super-admin/medications'],
  },
  { email: 'admin@joeymed.test', password: 'Admin!2026', pages: ['/admin', '/admin/integration', '/admin/visits'] },
  { email: 'dr.lindqvist@healthemr.test', password: 'Provider!2026', pages: ['/clinic'] },
  { email: 'rx@firstchoice.test', password: 'Pharmacy!2026', pages: ['/dispensary', '/dispensary/catalog'] },
];

let failures = 0;
const ok = (label, passed, detail) => {
  console.log(`  ${passed ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
};

/** Relative luminance, per WCAG. */
function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const rgb = (value) => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);

const browser = await chromium.launch({ channel: 'chrome' });

for (const role of ROLES) {
  console.log(`\n${role.email}`);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  await page.goto(`${WEB}/login`);
  await page.fill('input[name="email"]', role.email);
  await page.fill('input[name="password"]', role.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('login')),
    page.click('button[type="submit"]'),
  ]);

  for (const path of role.pages) {
    await page.goto(WEB + path);
    await page.waitForTimeout(1800);

    const problems = await page.evaluate(() => {
      const found = [];
      const named = (el) =>
        (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();

      document.querySelectorAll('button, a[href], [role="button"]').forEach((el) => {
        if (!named(el) && !el.querySelector('img[alt]:not([alt=""])')) {
          found.push(`unnamed control: ${el.outerHTML.slice(0, 60)}`);
        }
      });

      document.querySelectorAll('input, select, textarea').forEach((el) => {
        if (el.type === 'hidden' || el.getAttribute('aria-hidden') === 'true') return;
        const labelled =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          el.closest('label') ||
          (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
        if (!labelled) found.push(`unlabelled ${el.tagName.toLowerCase()}[${el.type ?? ''}]`);
      });

      document.querySelectorAll('img:not([alt])').forEach(() => found.push('img without alt'));

      const levels = [...document.querySelectorAll('main h1,main h2,main h3,main h4,main h5')].map(
        (h) => Number(h.tagName[1]),
      );
      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i] - levels[i - 1] > 1) {
          found.push(`heading jumps h${levels[i - 1]} to h${levels[i]}`);
        }
      }

      return [...new Set(found)];
    });

    ok(`${path} is navigable and labelled`, problems.length === 0, problems.slice(0, 3).join(' | '));

    // Contrast on the text that actually renders, against what is behind it.
    const thin = await page.evaluate(() => {
      const out = [];
      const behind = (el) => {
        let node = el;
        while (node && node !== document.documentElement) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && !bg.includes('rgba(0, 0, 0, 0)')) return bg;
          node = node.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };

      document.querySelectorAll('main p, main span, main td, main th, main a, main h2, main h3').forEach((el) => {
        const text = (el.textContent ?? '').trim();
        if (!text || el.children.length) return;
        const style = getComputedStyle(el);
        const size = parseFloat(style.fontSize);
        out.push({
          text: text.slice(0, 28),
          color: style.color,
          background: behind(el),
          size,
          bold: Number(style.fontWeight) >= 700,
        });
      });
      return out;
    });

    const failing = thin
      .map((item) => ({ ...item, ratio: contrast(rgb(item.color), rgb(item.background)) }))
      // WCAG AA: 3:1 for large text, 4.5:1 otherwise.
      .filter((item) => item.ratio < (item.size >= 24 || (item.size >= 18.66 && item.bold) ? 3 : 4.5));

    ok(
      `${path} text meets AA contrast`,
      failing.length === 0,
      failing
        .slice(0, 3)
        .map((f) => `"${f.text}" ${f.ratio.toFixed(2)}:1`)
        .join(' | '),
    );
  }

  await context.close();
}

// A dialog has to hold the keyboard, or Tab walks off behind it.
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
await page.goto(`${WEB}/login`);
await page.fill('input[name="email"]', 'super@healthemr.test');
await page.fill('input[name="password"]', 'Super!2026');
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes('login')),
  page.click('button[type="submit"]'),
]);

console.log('\nDialogs');
const id = await page.evaluate(async () => {
  const response = await fetch('/api/bff/v1/super-admin/admins?pageSize=50');
  return (await response.json()).data.find((row) => row.slug === 'joeyMed').id;
});
await page.goto(`${WEB}/super-admin/admins/${id}`);
await page.waitForTimeout(3500);
await page.getByRole('button', { name: /issue a key/i }).click();
await page.waitForTimeout(700);

ok('it announces itself as a dialog', (await page.locator('[role="dialog"]').count()) > 0);

const inside = await page.evaluate(async () => {
  const dialog = document.querySelector('[role="dialog"]');
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (!dialog.contains(document.activeElement)) return false;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  }
  return true;
});
ok('focus starts inside it', inside);

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('Escape closes it', (await page.locator('[role="dialog"]').count()) === 0);

await context.close();
await browser.close();

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
