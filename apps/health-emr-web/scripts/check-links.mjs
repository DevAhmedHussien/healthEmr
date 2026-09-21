/**
 * Walks every navigable link for every role and fails on any dead one.
 *
 * This exists because I shipped nav entries pointing at pages that did not
 * exist. A link is part of the contract a UI makes with its user, so it gets a
 * test like anything else.
 */
const WEB = 'http://localhost:3000';

async function session(email, password) {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)); } };
  const get = async (p) => { const r = await fetch(`${WEB}${p}`, { headers: { cookie: cookie() }, redirect: 'manual' }); absorb(r); return r; };

  const { csrfToken } = await (await get('/api/auth/csrf')).json();
  absorb(await fetch(`${WEB}/api/auth/callback/credentials`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${WEB}/`, json: 'true' }),
    redirect: 'manual',
  }));
  return { get, user: (await (await get('/api/auth/session')).json()).user };
}

const su = await session('super@healthemr.test', 'Super!2026');

// Real ids so the detail routes are exercised with data, not just a 200 shell.
const provApp = (await (await su.get('/api/bff/v1/super-admin/onboarding/providers?pageSize=1')).json()).data[0];
const pharmApp = (await (await su.get('/api/bff/v1/super-admin/onboarding/pharmacies?pageSize=1')).json()).data[0];
const provId = (await (await su.get('/api/bff/v1/super-admin/providers?pageSize=1')).json()).data?.[0]?.id;
const pharmId = (await (await su.get('/api/bff/v1/super-admin/pharmacies/directory?pageSize=1')).json()).data?.[0]?.id;
const patientId = (await (await su.get('/api/bff/v1/super-admin/patients?pageSize=1')).json()).data?.[0]?.id;
const rx = (await (await su.get('/api/bff/v1/super-admin/prescriptions?pageSize=1')).json()).data?.[0];
const tenantId = (await (await su.get('/api/bff/v1/super-admin/admins?pageSize=1')).json()).data?.[0]?.id;
const invoiceId = (await (await su.get('/api/bff/v1/super-admin/invoices?pageSize=1')).json()).data?.[0]?.id;

// Detail ids fetched as the role that will open them, never as Super Admin. A
// visit belonging to another tenant, or to another clinician's queue, 404s on
// its own page — which would read here as a broken link rather than as the
// access rule working.
const reyes = await session('dr.reyes@healthemr.test', 'Provider!2026');
const clinicVisitId = (await (await reyes.get('/api/bff/v1/clinic/queue?limit=1')).json()).data?.[0]?.visitId;

const joey = await session('admin@joeymed.test', 'Admin!2026');
const adminVisitId = (await (await joey.get('/api/bff/v1/admin/visits?pageSize=1')).json()).data?.[0]?.id;

const ROLES = [
  { who: 'super@healthemr.test', pw: 'Super!2026', paths: [
    '/super-admin', '/super-admin/applications',
    `/super-admin/applications/provider/${provApp?.id}`,
    `/super-admin/applications/pharmacy/${pharmApp?.id}`,
    '/super-admin/providers', '/super-admin/pharmacies',
    ...(provId ? [`/super-admin/providers/${provId}`] : []),
    ...(pharmId ? [`/super-admin/pharmacies/${pharmId}`] : []),
    '/super-admin/admins', '/super-admin/analytics', '/super-admin/messages', '/profile',
    '/super-admin/patients', '/super-admin/prescriptions',
    ...(patientId ? [`/super-admin/patients/${patientId}`] : []),
    ...(rx?.visitId ? [`/super-admin/visits/${rx.visitId}/questionnaire`] : []),
    '/super-admin/activity', '/super-admin/invoices', '/super-admin/reports', '/super-admin/stuck',
    ...(tenantId ? [`/super-admin/admins/${tenantId}`] : []),
    ...(invoiceId ? [`/super-admin/invoices/${invoiceId}`] : []),
  ]},
  { who: 'admin@joeymed.test', pw: 'Admin!2026', paths: [
    '/admin', '/admin/patients', '/admin/visits', '/admin/prescriptions', '/admin/messages',
    ...(adminVisitId ? [`/admin/visits/${adminVisitId}`] : []),
  ]},
  { who: 'dr.reyes@healthemr.test', pw: 'Provider!2026', paths: [
    '/clinic', '/clinic/earnings', '/clinic/messages',
    ...(clinicVisitId ? [`/clinic/visits/${clinicVisitId}`] : []),
  ]},
  { who: 'rx@firstchoice.test', pw: 'Pharmacy!2026', paths: ['/dispensary', '/dispensary/catalog', '/dispensary/settings', '/dispensary/messages'] },
  { who: 'sofia.reyes@demo.test', pw: 'Patient!2026', paths: ['/portal', '/portal/visits', '/portal/prescriptions', '/portal/messages'] },
];
const PUBLIC = [
  '/welcome', '/login', '/apply/pharmacy', '/apply/provider',
  '/intake/joeyMed?visit=weightloss',
  '/form', '/form/weight-loss', '/form/wellness', '/form/sexual-health', '/form/test',
];

let dead = 0;
for (const path of PUBLIC) {
  const r = await fetch(`${WEB}${path}`, { redirect: 'manual' });
  if (r.status !== 200) { dead++; console.log(`  DEAD ${r.status} ${path}`); }
}
console.log(`  public: ${PUBLIC.length - dead}/${PUBLIC.length} OK`);

for (const role of ROLES) {
  const s = await session(role.who, role.pw);
  let bad = 0;
  for (const path of role.paths) {
    const r = await s.get(path);
    if (r.status !== 200) { bad++; dead++; console.log(`  DEAD ${r.status} ${path}  (${s.user.role})`); }
  }
  console.log(`  ${s.user.role.padEnd(12)} ${role.paths.length - bad}/${role.paths.length} OK`);
}

console.log(dead === 0 ? '\n  NO DEAD LINKS' : `\n  ${dead} DEAD LINKS`);
process.exit(dead ? 1 : 0);
