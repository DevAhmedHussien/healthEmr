/**
 * Every declared column filter, against the running API.
 *
 * The model paths in each service's filter map are strings, so TypeScript
 * cannot tell a real relation from a typo — `strength` on a table whose column
 * is `concentration` compiles perfectly and 500s at runtime. This sends every
 * one of them and reports anything that is not a 200.
 */
const API = 'http://localhost:4000';

const login = async (email, password) => {
  const r = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`${email}: ${r.status}`);
  return (await r.json()).tokens.accessToken;
};

const superAdmin = await login('super@healthemr.test', 'Super!2026');
const admin = await login('admin@joeymed.test', 'Admin!2026').catch(() => null);
const pharmacy = await login('rx@firstchoice.test', 'Pharmacy!2026').catch(() => null);

/** A value each kind will accept, so the clause is actually built and run. */
const SAMPLE = { text: 'a', date: '2026-01-01', number: '1', presence: 'any', list: 'TX', exact: 'TX' };

const ENDPOINTS = [
  ['super-admin/visits', superAdmin, { patient: 'text', email: 'text', phone: 'text', tenant: 'text', category: 'exact', requestStatus: 'exact', provider: 'text', patientState: 'exact', reason: 'text', masterId: 'text', shipment: 'text', tracking: 'text', charge: 'number', createdAt: 'date', decidedAt: 'date', updatedAt: 'date' }],
  ['super-admin/prescriptions', superAdmin, { medication: 'text', patient: 'text', email: 'text', phone: 'text', patientState: 'exact', tenant: 'text', prescriber: 'text', licence: 'text', masterId: 'text', shipment: 'text', tracking: 'text', invoice: 'presence', invoiceNumber: 'text', signedAt: 'date', createdAt: 'date', updatedAt: 'date' }],
  ['super-admin/patients', superAdmin, { mrn: 'text', lastName: 'text', email: 'text', phone: 'text', residenceState: 'exact', sexAtBirth: 'exact', accounts: 'text', visits: 'presence', prescriptions: 'presence', allergies: 'presence', createdAt: 'date' }],
  ['super-admin/providers', superAdmin, { lastName: 'text', email: 'text', npi: 'text', states: 'text', categories: 'text', assignedAdmin: 'text' }],
  ['super-admin/pharmacies/directory', superAdmin, { name: 'text', slug: 'text', integrationType: 'exact', assignedAdmin: 'text', categories: 'text', medicationCount: 'presence', tenantCount: 'presence' }],
  ['super-admin/admins', superAdmin, { name: 'text', owner: 'text', email: 'text', phone: 'text', slug: 'text', patients: 'presence', providers: 'presence', pharmacies: 'presence', createdAt: 'date' }],
  ['super-admin/invoices', superAdmin, { number: 'text', tenant: 'text', patient: 'text', totalCents: 'number', issuedAt: 'date', dueAt: 'date', paidAt: 'date', lines: 'presence', payments: 'presence', createdAt: 'date' }],
  ['super-admin/activity', superAdmin, { actor: 'text', tenant: 'text', entity: 'text', ip: 'text', sequence: 'number', createdAt: 'date' }],
  ['super-admin/medications', superAdmin, { favouriteName: 'text', pharmacy: 'text', category: 'text', strength: 'text', dispense: 'text', medId: 'text', kitCode: 'text', defaultSig: 'text', daysSupply: 'number', costOfGoodsCents: 'number', sell: 'number', refills: 'text', notes: 'text', visitType: 'text', createdAt: 'date', updatedAt: 'date' }],
  ['super-admin/onboarding/providers', superAdmin, { lastName: 'text', email: 'text', npi: 'text', states: 'text', categories: 'list', documents: 'presence', createdAt: 'date' }],
  ['super-admin/onboarding/pharmacies', superAdmin, { legalName: 'text', contactEmail: 'text', integrationType: 'exact', statesServed: 'list', categorySlugs: 'list', documents: 'presence', createdAt: 'date' }],
  ['admin/visits', admin, { masterId: 'text', patient: 'text', category: 'exact', requestStatus: 'exact', provider: 'text', patientState: 'exact', reason: 'text', shipment: 'text', tracking: 'text', createdAt: 'date', decidedAt: 'date', updatedAt: 'date' }],
  ['admin/prescriptions', admin, { medication: 'text', patient: 'text', prescriber: 'text', licence: 'text', masterId: 'text', shipment: 'text', tracking: 'text', invoice: 'presence', invoiceNumber: 'text', signedAt: 'date', createdAt: 'date', updatedAt: 'date' }],
  ['admin/patients', admin, { mrn: 'text', lastName: 'text', email: 'text', phone: 'text', residenceState: 'exact', sexAtBirth: 'exact', visits: 'presence', prescriptions: 'presence', allergies: 'presence', createdAt: 'date' }],
  ['dispensary/orders', pharmacy, { medication: 'text', patient: 'text', phone: 'text', prescriber: 'text', directions: 'text', orderId: 'text', tracking: 'text', shipTo: 'text', patientState: 'exact', daysSupply: 'number', dose: 'text', createdAt: 'date', submittedAt: 'date', signedAt: 'date' }],
];

let checked = 0;
let broken = 0;

for (const [path, token, filters] of ENDPOINTS) {
  if (!token) {
    console.log(`\n${path}  — no account, skipped`);
    continue;
  }

  const failures = [];
  for (const [key, kind] of Object.entries(filters)) {
    checked += 1;
    const url = `${API}/v1/${path}?pageSize=1&${key}=${encodeURIComponent(SAMPLE[kind])}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) continue;
    broken += 1;
    const body = await response.text();
    failures.push(`${key}=${SAMPLE[kind]} → ${response.status} ${body.slice(0, 120)}`);
  }

  const n = Object.keys(filters).length;
  console.log(`\n${failures.length ? '✗' : '✓'} ${path}  (${n - failures.length}/${n})`);
  for (const line of failures) console.log(`    ${line}`);
}

console.log(`\n${checked - broken} of ${checked} filters answered 200\n`);
process.exit(broken ? 1 : 0);
