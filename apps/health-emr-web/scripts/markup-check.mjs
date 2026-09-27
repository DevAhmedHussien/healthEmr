/**
 * Markup a browser silently repairs, and React then cannot reconcile.
 *
 * A `<table>` nested inside another is the one that bit: the parser lifts the
 * inner table out, the server-rendered HTML and the client tree stop matching,
 * and the page throws a hydration error at runtime with nothing wrong at build
 * time. Types do not catch it, lint does not catch it, and it only appears on
 * the one screen that has it.
 *
 * So the check is on the rendered DOM, across every page, for the invalid
 * nestings that cause it.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3005';

const ROLES = [
  {
    who: 'super@healthemr.test',
    pw: 'Super!2026',
    lands: /super-admin/,
    paths: [
      '/super-admin',
      '/super-admin/providers',
      '/super-admin/providers/activity',
      '/super-admin/patients',
      '/super-admin/visits',
      '/super-admin/prescriptions',
      '/super-admin/medications',
      '/super-admin/invoices',
      '/super-admin/activity',
      '/super-admin/admins',
      '/super-admin/pharmacies',
    ],
  },
  {
    who: 'dr.lindqvist@healthemr.test',
    pw: 'Provider!2026',
    lands: /clinic/,
    paths: ['/clinic', '/clinic/hours', '/clinic/licences', '/clinic/earnings', '/clinic/decisions'],
  },
  {
    who: 'rx@firstchoice.test',
    pw: 'Pharmacy!2026',
    lands: /dispensary/,
    paths: ['/dispensary', '/dispensary/catalog', '/dispensary/settings'],
  },
];

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const browser = await chromium.launch({ channel: 'chrome' });

try {
  for (const role of ROLES) {
    console.log(`\n${role.who.split('@')[0]}`);
    const page = await (await browser.newContext()).newPage();

    // Hydration failures arrive as console errors, so they are collected too.
    const hydration = [];
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && /hydrat|cannot be a (child|descendant)/i.test(text)) {
        hydration.push(text.slice(0, 120));
      }
    });

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.fill('input[name="email"]', role.who);
    await page.fill('input[name="password"]', role.pw);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(9_000);

    for (const path of role.paths) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForTimeout(2_500);

      const bad = await page.evaluate(() => {
        const problems = [];
        // Every nesting here is one the HTML parser rewrites rather than keeps.
        const rules = [
          ['table table', 'a table inside a table'],
          ['p p', 'a paragraph inside a paragraph'],
          ['p div', 'a div inside a paragraph'],
          ['a a', 'a link inside a link'],
          ['button button', 'a button inside a button'],
          ['form form', 'a form inside a form'],
          ['ul > div', 'a div as a direct child of a list'],
        ];
        for (const [selector, description] of rules) {
          if (document.querySelector(selector)) problems.push(description);
        }
        return problems;
      });

      ok(path, bad.length === 0 && hydration.length === 0, bad[0] ?? hydration[0] ?? 'clean');
      hydration.length = 0;
    }

    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
