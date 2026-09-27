/**
 * Builds the API reference from the running server's OpenAPI document.
 *
 * Generated rather than written, so it cannot drift from the code: every
 * summary, parameter and status here comes from the decorators on the
 * controllers. The partner routes are added by hand because that controller is
 * deliberately excluded from Swagger — it is a compatibility surface for
 * clients, not part of our own console's documentation — and it is the one
 * integrators most need.
 *
 *   node scripts/build-api-docs.mjs [--spec http://localhost:4000/docs-json]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

const specUrl = process.argv.includes('--spec')
  ? process.argv[process.argv.indexOf('--spec') + 1]
  : 'http://localhost:4000/docs-json';

const spec = await fetch(specUrl)
  .then((response) => response.json())
  .catch(() => {
    console.error(`Could not read the spec from ${specUrl}. Is the API running?`);
    process.exit(1);
  });

// Refuse rather than overwrite. A spec that came back empty — the API restarting,
// a wrong URL — would otherwise replace a complete reference with a blank page,
// and the failure only shows up when somebody opens the file looking for an
// endpoint that is no longer in it.
const operationCount = Object.values(spec.paths ?? {}).reduce(
  (total, item) =>
    total + Object.keys(item).filter((key) => METHOD_ORDER.includes(key)).length,
  0,
);
if (operationCount < 50) {
  console.error(
    `The spec at ${specUrl} carries only ${operationCount} operations, which is too few to be ` +
      'the whole API. Refusing to overwrite the reference with it.',
  );
  process.exit(1);
}

/**
 * Who calls each group of endpoints.
 *
 * Grouping by caller rather than by URL is the whole point: somebody reading
 * this is one of these people, and wants the eight routes that concern them
 * rather than all 108 in alphabetical order.
 */
const GROUPS = [
  {
    id: 'partner',
    title: 'Partner API',
    who: 'A client business’s server',
    auth: 'Tenant API key (Bearer)',
    blurb:
      'What a telehealth business integrates against. Shaped to match the incumbent’s contract, so a ' +
      'client already integrated elsewhere can repoint by changing a base URL and a token.',
    match: (path) => path.startsWith('/partner/'),
  },
  {
    id: 'auth',
    title: 'Authentication',
    who: 'Anyone signing in',
    auth: 'None — these issue the session',
    blurb: 'Sign in, refresh, sign out, and claim an invited account by setting a password.',
    match: (path) => path.startsWith('/v1/auth'),
  },
  {
    id: 'public',
    title: 'Public',
    who: 'Applicants, with no account',
    auth: 'None (rate limited)',
    blurb: 'The pharmacy and provider application forms, and the documents each applicant must supply.',
    match: (path) => path.startsWith('/v1/public/'),
  },
  {
    id: 'super-admin',
    title: 'Platform owner',
    who: 'SUPER_ADMIN',
    auth: 'Session (Bearer)',
    blurb:
      'The console: client accounts, applications, the provider and pharmacy directories, patients, ' +
      'prescriptions, billing, reports, the activity trail, and everything that changes state.',
    match: (path) => path.startsWith('/v1/super-admin'),
  },
  {
    id: 'admin',
    title: 'Client business',
    who: 'ADMIN',
    auth: 'Session (Bearer)',
    blurb:
      'A telehealth business looking at its own patients and orders. Scoped to that tenant in the ' +
      'data layer, so a missing filter cannot leak another client’s records.',
    match: (path) => path.startsWith('/v1/admin'),
  },
  {
    id: 'clinic',
    title: 'Provider',
    who: 'PROVIDER',
    auth: 'Session (Bearer)',
    blurb: 'A clinician’s review queue, and the decision that turns a visit into a prescription.',
    match: (path) => path.startsWith('/v1/clinic'),
  },
  {
    id: 'dispensary',
    title: 'Pharmacy',
    who: 'PHARMACY',
    auth: 'Session (Bearer)',
    blurb:
      'The fill queue, shipment and issue reporting, the pharmacy’s own catalogue, its profile, and ' +
      'the connection that carries orders into its own system.',
    match: (path) => path.startsWith('/v1/dispensary'),
  },
  {
    id: 'portal',
    title: 'Patient',
    who: 'PATIENT',
    auth: 'Session (Bearer)',
    blurb: 'A patient’s own visits, prescriptions and shipments. Nobody else’s, by construction.',
    match: (path) => path.startsWith('/v1/portal'),
  },
  {
    id: 'shared',
    title: 'Shared',
    who: 'Any signed-in role',
    auth: 'Session (Bearer)',
    blurb: 'Notifications and messaging, which every role has in its own scope.',
    match: (path) => path.startsWith('/v1/notifications') || path.startsWith('/v1/messages') || path.startsWith('/v1/chat'),
  },
  {
    id: 'ops',
    title: 'Operations',
    who: 'Load balancers and monitoring',
    auth: 'None',
    blurb: 'Liveness and readiness.',
    match: (path) => path === '/healthz' || path === '/readyz',
  },
];

/**
 * What the decorators cannot say, keyed by `METHOD /path`.
 *
 * The partner section itself is built from the spec, like every other section,
 * so a new endpoint appears here the moment it exists. This adds only the parts
 * a decorator has no room for — a worked example of the payload, and the table
 * of refusals an integrator will actually hit. An earlier version of this file
 * listed the endpoints by hand and was nine behind by the time anyone noticed.
 */
const PARTNER_EXTRAS = {
  'POST /partner/v1/visits': {
    body: `{
  "masterId": "your-unique-id",
  "company": "yourSlug",
  "visitType": "weightloss",
  "pharmacyId": "first-choice",
  "formObj": {
    "consentsSigned": true,
    "firstName": "…", "lastName": "…",
    "dob": "MM/DD/YYYY", "sex": "Female",
    "phone": "5551234567", "email": "…",
    "address": "…", "city": "…", "state": "TX", "zip": "73301",
    "allergies": "…", "medicalConditions": "…", "selfReportedMeds": "…",
    "Q1": "question", "A1": "answer",
    "patientPreference": [
      { "medId": "SEMA-2.5", "name": "…", "strength": "…",
        "quantity": "1", "refills": "0" }
    ]
  }
}`,
    errors: [
      ['No company found', 'The <code>company</code> does not match the tenant the API key belongs to.'],
      ['Company does not have that visit type', 'That category is not enabled for this client.'],
      ['Pharmacy mismatch in patientPreference', 'The named pharmacy is not on this client’s roster, or cannot dispense this product.'],
      ['<em>Pharmacy</em> does not stock <em>kit</em>', 'The pharmacy does not carry that kit. Call the medications lookup below for what it does.'],
      ['Branded med with compounding pharmacy', 'A branded product was sent to a compounding-only pharmacy.'],
      ['State not valid', 'No contracted clinician is licensed in that state, or the client may not sell there.'],
      ['Duplicate masterId', 'That <code>masterId</code> already exists for this client.'],
    ],
  },
};

function collect() {
  const seen = new Set();
  const groups = GROUPS.map((group) => ({ ...group, operations: [] }));

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHOD_ORDER) {
      const operation = item[method];
      if (!operation) continue;
      const group = groups.find((candidate) => candidate.match(path));
      if (!group) continue;
      seen.add(`${method} ${path}`);
      group.operations.push({ method, path, ...operation, parameters: operation.parameters ?? item.parameters ?? [] });
    }
  }

  const partnerGroup = groups.find((group) => group.id === 'partner');
  for (const operation of partnerGroup.operations) {
    Object.assign(operation, PARTNER_EXTRAS[`${operation.method.toUpperCase()} ${operation.path}`] ?? {});
  }

  for (const group of groups) {
    group.operations.sort(
      (a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
    );
  }

  return groups.filter((group) => group.operations.length);
}

const escape = (value = '') =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Descriptions are authored as prose and may carry a little inline markup. */
const rich = (value = '') =>
  escape(value)
    .replace(/&lt;code&gt;/g, '<code>')
    .replace(/&lt;\/code&gt;/g, '</code>')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

function renderParams(parameters) {
  const rows = parameters.filter((parameter) => parameter.in !== 'header');
  if (!rows.length) return '';
  return `<table class="params"><thead><tr><th>Parameter</th><th>In</th><th>Type</th><th></th></tr></thead><tbody>${rows
    .map(
      (parameter) => `<tr>
        <td><code>${escape(parameter.name)}</code>${parameter.required ? '<span class="req">required</span>' : ''}</td>
        <td>${escape(parameter.in)}</td>
        <td class="muted">${escape(parameter.schema?.type ?? parameter.schema?.format ?? '—')}</td>
        <td class="muted">${rich(parameter.description ?? '')}</td>
      </tr>`,
    )
    .join('')}</tbody></table>`;
}

function renderResponses(responses = {}) {
  const codes = Object.keys(responses);
  if (!codes.length) return '';
  return `<div class="responses">${codes
    .map((code) => {
      const tone = code.startsWith('2') ? 'ok' : code.startsWith('4') ? 'warn' : 'err';
      return `<span class="status ${tone}"><b>${escape(code)}</b> ${escape(responses[code].description ?? '')}</span>`;
    })
    .join('')}</div>`;
}

function renderOperation(operation) {
  const detail = [
    operation.description ? `<p class="desc">${rich(operation.description)}</p>` : '',
    operation.body ? `<pre><code>${escape(operation.body)}</code></pre>` : '',
    renderParams(operation.parameters ?? []),
    operation.errors
      ? `<table class="params"><thead><tr><th>Refused with</th><th></th></tr></thead><tbody>${operation.errors
          .map(([error, why]) => `<tr><td><code>${rich(error)}</code></td><td class="muted">${rich(why)}</td></tr>`)
          .join('')}</tbody></table>`
      : '',
    renderResponses(operation.responses),
  ]
    .filter(Boolean)
    .join('');

  return `<details class="op" data-search="${escape(`${operation.method} ${operation.path} ${operation.summary ?? ''}`).toLowerCase()}">
    <summary>
      <span class="verb ${operation.method}">${operation.method.toUpperCase()}</span>
      <code class="path">${escape(operation.path)}</code>
      <span class="summary">${escape(operation.summary ?? '')}</span>
    </summary>
    <div class="body">${detail || '<p class="desc muted">No further detail.</p>'}</div>
  </details>`;
}

const groups = collect();
const total = groups.reduce((sum, group) => sum + group.operations.length, 0);

const html = `<title>HealthEMR API Reference</title>
<style>
  :root {
    --ink: #22303E;
    --body: #4B4B5A;
    --muted: #6E6B7B;
    --faint: #9A97A8;
    --primary: #115FAA;
    --primary-soft: #E7F0F9;
    --ground: #F0F5FA;
    --card: #FFFFFF;
    --line: #E4E6EB;
    --line-soft: #EFF0F3;
    --get: #00A1B5;
    --post: #03A87C;
    --patch: #D9700F;
    --delete: #E01F32;
    --radius: 0.357rem;
    --sans: "Segoe UI", Inter, Roboto, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    --display: "Avenir Next", "Segoe UI", Futura, system-ui, -apple-system, sans-serif;
    --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  }
  :root:not([data-theme="light"]) {
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #EAECEF;
      --body: #C6C9D1;
      --muted: #9AA0AC;
      --faint: #757C8A;
      --primary: #5FA8E8;
      --primary-soft: #16334F;
      --ground: #0F1620;
      --card: #16202C;
      --line: #25313F;
      --line-soft: #1D2734;
      --get: #3FC7D6;
      --post: #3FCB9E;
      --patch: #E8A24A;
      --delete: #F16173;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --ink: #EAECEF;
    --body: #C6C9D1;
    --muted: #9AA0AC;
    --faint: #757C8A;
    --primary: #5FA8E8;
    --primary-soft: #16334F;
    --ground: #0F1620;
    --card: #16202C;
    --line: #25313F;
    --line-soft: #1D2734;
    --get: #3FC7D6;
    --post: #3FCB9E;
    --patch: #E8A24A;
    --delete: #F16173;
    color-scheme: dark;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--body);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  code, pre { font-family: var(--mono); }

  .shell { max-width: 1180px; margin: 0 auto; padding: 0 1.25rem 5rem; }

  header.masthead {
    padding: 3.5rem 0 2rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 2rem;
  }
  .eyebrow {
    font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--primary); font-weight: 600; margin: 0 0 0.6rem;
  }
  h1 {
    font-family: var(--display);
    font-size: clamp(1.9rem, 4vw, 2.6rem);
    line-height: 1.15; margin: 0 0 0.75rem; color: var(--ink);
    letter-spacing: -0.015em; text-wrap: balance;
  }
  .lede { max-width: 62ch; margin: 0; color: var(--muted); font-size: 1.02rem; }
  .facts { display: flex; flex-wrap: wrap; gap: 1.75rem; margin-top: 1.75rem; }
  .fact b {
    display: block; font-family: var(--display); font-size: 1.5rem;
    color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.2;
  }
  .fact span { font-size: 0.78rem; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; }

  .layout { display: grid; grid-template-columns: 15rem 1fr; gap: 2.5rem; align-items: start; }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } nav.toc { position: static; } }

  nav.toc { position: sticky; top: 1.5rem; }
  nav.toc ol { list-style: none; margin: 0; padding: 0; }
  nav.toc a {
    display: block; padding: 0.4rem 0.7rem; border-radius: var(--radius);
    color: var(--muted); text-decoration: none; font-size: 0.88rem;
  }
  nav.toc a:hover { background: var(--primary-soft); color: var(--primary); }
  nav.toc .count { float: right; color: var(--faint); font-size: 0.78rem; font-variant-numeric: tabular-nums; }

  .filter {
    width: 100%; padding: 0.6rem 0.9rem; margin-bottom: 1.25rem;
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--card); color: var(--ink); font: inherit; font-size: 0.9rem;
  }
  .filter:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }

  section.group { margin-bottom: 2.75rem; scroll-margin-top: 1.5rem; }
  section.group > h2 {
    font-family: var(--display); font-size: 1.3rem; color: var(--ink);
    margin: 0 0 0.35rem; letter-spacing: -0.01em;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; margin: 0 0 0.6rem; font-size: 0.8rem; color: var(--faint); }
  .meta b { color: var(--muted); font-weight: 600; }
  .group-blurb { margin: 0 0 1rem; color: var(--muted); max-width: 70ch; font-size: 0.92rem; }

  details.op {
    background: var(--card); border-radius: var(--radius);
    box-shadow: 0 2px 6px rgba(34,48,62,0.05); margin-bottom: 0.4rem;
    overflow: hidden;
  }
  details.op[open] { box-shadow: 0 4px 16px rgba(34,48,62,0.09); }
  details.op summary {
    display: flex; align-items: baseline; gap: 0.7rem; flex-wrap: wrap;
    padding: 0.7rem 0.95rem; cursor: pointer; list-style: none;
  }
  details.op summary::-webkit-details-marker { display: none; }
  details.op summary:hover { background: var(--primary-soft); }
  .verb {
    font-family: var(--mono); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em;
    padding: 0.18rem 0.45rem; border-radius: 3px; color: #fff; flex: none; min-width: 3.9rem; text-align: center;
  }
  .verb.get { background: var(--get); }
  .verb.post { background: var(--post); }
  .verb.put, .verb.patch { background: var(--patch); }
  .verb.delete { background: var(--delete); }
  .path { font-size: 0.86rem; color: var(--ink); word-break: break-all; }
  .summary { color: var(--muted); font-size: 0.85rem; margin-left: auto; text-align: right; }
  @media (max-width: 620px) { .summary { margin-left: 0; text-align: left; width: 100%; } }

  .body { padding: 0.25rem 0.95rem 1rem; border-top: 1px solid var(--line-soft); }
  .desc { margin: 0.8rem 0; max-width: 72ch; }
  .muted { color: var(--muted); }

  pre {
    background: var(--ground); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 0.85rem 1rem; overflow-x: auto; font-size: 0.8rem; line-height: 1.55; margin: 0.8rem 0;
  }
  code { font-size: 0.86em; }
  .body > table + table { margin-top: 0.9rem; }

  table.params { width: 100%; border-collapse: collapse; margin: 0.8rem 0; font-size: 0.85rem; display: block; overflow-x: auto; }
  table.params thead th {
    text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--faint); font-weight: 600; padding: 0 0.6rem 0.4rem 0; border-bottom: 1px solid var(--line);
  }
  table.params td { padding: 0.45rem 0.6rem 0.45rem 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  .req { margin-left: 0.4rem; font-size: 0.66rem; color: var(--delete); text-transform: uppercase; letter-spacing: 0.05em; }

  .responses { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.9rem; }
  .status {
    font-size: 0.76rem; padding: 0.22rem 0.55rem; border-radius: var(--radius);
    background: var(--ground); border: 1px solid var(--line); color: var(--muted);
  }
  .status b { font-family: var(--mono); color: var(--ink); }
  .status.ok { border-color: color-mix(in srgb, var(--post) 40%, var(--line)); }
  .status.warn { border-color: color-mix(in srgb, var(--patch) 40%, var(--line)); }
  .status.err { border-color: color-mix(in srgb, var(--delete) 40%, var(--line)); }

  .note {
    background: var(--card); border-left: 3px solid var(--primary);
    border-radius: var(--radius); padding: 0.9rem 1.1rem; margin: 0 0 2rem;
    font-size: 0.9rem; color: var(--muted); max-width: 72ch;
  }
  .note b { color: var(--ink); }
  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line); font-size: 0.82rem; color: var(--faint); }
  .hidden { display: none !important; }
</style>

<div class="shell">
  <header class="masthead">
    <p class="eyebrow">HealthEMR</p>
    <h1>API Reference</h1>
    <p class="lede">
      Every endpoint on the platform, grouped by who calls it. Generated from the running
      server&rsquo;s OpenAPI document, so nothing here can drift from what the code actually does.
    </p>
    <div class="facts">
      <div class="fact"><b>${total}</b><span>Endpoints</span></div>
      <div class="fact"><b>${groups.length}</b><span>Audiences</span></div>
      <div class="fact"><b>v${escape(spec.info?.version ?? '1.0')}</b><span>Version</span></div>
    </div>
  </header>

  <div class="layout">
    <nav class="toc">
      <ol>
        ${groups
          .map(
            (group) =>
              `<li><a href="#${group.id}">${escape(group.title)}<span class="count">${group.operations.length}</span></a></li>`,
          )
          .join('')}
      </ol>
    </nav>

    <main>
      <input class="filter" type="search" placeholder="Filter by path, method or summary…" aria-label="Filter endpoints" />

      <p class="note">
        <b>Authentication.</b> Console endpoints take a session bearer token from
        <code>POST /v1/auth/login</code>. The partner API takes a tenant API key as
        <code>Authorization: Bearer hemr_…</code> — never a user session. Every response carries an
        <code>x-request-id</code>; quote it when reporting a problem.
      </p>

      ${groups
        .map(
          (group) => `<section class="group" id="${group.id}">
            <h2>${escape(group.title)}</h2>
            <p class="meta"><span><b>Called by</b> ${escape(group.who)}</span><span><b>Auth</b> ${escape(group.auth)}</span><span><b>${group.operations.length}</b> endpoints</span></p>
            <p class="group-blurb">${escape(group.blurb)}</p>
            ${group.operations.map(renderOperation).join('')}
          </section>`,
        )
        .join('')}

      <footer>
        Generated from <code>${escape(specUrl)}</code>. Rebuild with
        <code>node scripts/build-api-docs.mjs</code> after changing a controller.
      </footer>
    </main>
  </div>
</div>

<script>
  // Filtering is the feature a reference of this size lives or dies by.
  const filter = document.querySelector('.filter');
  const ops = [...document.querySelectorAll('details.op')];
  const sections = [...document.querySelectorAll('section.group')];

  filter.addEventListener('input', () => {
    const needle = filter.value.trim().toLowerCase();
    for (const op of ops) {
      const hit = !needle || op.dataset.search.includes(needle);
      op.classList.toggle('hidden', !hit);
      if (needle && hit) op.open = true;
      if (!needle) op.open = false;
    }
    for (const section of sections) {
      const anyVisible = [...section.querySelectorAll('details.op')].some((op) => !op.classList.contains('hidden'));
      section.classList.toggle('hidden', !anyVisible);
    }
  });
</script>`;

const out = resolve(process.cwd(), '../../docs/api-reference.html');
writeFileSync(out, html);
console.log(`${total} endpoints across ${groups.length} audiences → ${out}`);
