/**
 * Every column filter, round-tripped against real rows.
 *
 * verify-column-filters.mjs proves a filter does not 500. That is not the same
 * as proving it works: the name filter searched only `lastName` for months
 * while a column headed "Patient" showed "Elena Marsh", and every request came
 * back 200 with the wrong rows.
 *
 * So this asks the harder question. Take a row the list already returned, read
 * the value the column actually displays, type that value into the filter, and
 * require the same row back. A filter pointed at the wrong field fails here.
 *
 * Anything it cannot source a value for is reported, never skipped silently —
 * an unexercised filter is an unknown, not a pass.
 */
const API = 'http://localhost:4000';

const login = async (email, password) => {
  const r = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.ok ? (await r.json()).tokens.accessToken : null;
};

/**
 * Where a filter's value lives in the response, when the column is not simply
 * named after it. Left is the filter key, right is a path into the row.
 */
/**
 * Where a filter's value lives in the response, when the column is not simply
 * named after it. Only the ones a search cannot work out for itself.
 */
const ALIAS = {
  patient: 'patient.name',
  tenant: 'tenant.name',
  category: 'category.name',
  shipment: 'shipment.status',
  owner: 'ownerName',
  lastName: 'name',
  strength: 'concentration',
  dispense: 'dispenseQuantity',
  sell: 'sellPriceCents',
  notes: 'pharmacyNotes',
  actor: 'actor.name',
  entity: 'entityType',
  orderId: 'externalOrderId',
  shipTo: 'patient.shipTo',
  invoiceNumber: 'invoice.number',
  documents: '_count.documents',
  reason: 'refusedReason',
  charge: 'money.chargeCents',
  residenceState: 'state',
  patientState: ['patientState', 'patient.state'],
  // The list renames this on the way out — a visit's `createdAt` is the moment
  // it was submitted, and that is what the column is headed.
  createdAt: ['createdAt', 'submittedAt', 'queuedAt', 'at'],
  states: ['licensedStates', 'licenses[].state'],
  tracking: ['shipment.trackingNumber', 'trackingNumber'],
  legalName: 'legalName',
  contactEmail: 'contactEmail',
};

const has = (row, path) => {
  const value = read(row, path);
  if (value == null || value === '') return false;
  // A nested object is the container, not the displayed value: `patient` is
  // `{name, email, ...}`, and what the column shows is one field inside it.
  return Array.isArray(value) || typeof value !== 'object';
};

/**
 * The response field a filter should be able to find its own row by.
 *
 * Tried in order, because a global alias table lies: `email` is `patient.email`
 * on a visit and plain `email` on a patient. So prefer what the row actually
 * carries, then the alias, then anything nested under that exact name.
 */
function locate(row, key) {
  if (has(row, key)) return key;
  for (const alias of [ALIAS[key]].flat()) {
    if (alias && has(row, alias)) return alias;
  }
  const found = search(row, key, '', 0);
  return found ?? [ALIAS[key]].flat()[0] ?? key;
}

function search(value, key, prefix, depth) {
  if (depth > 3 || value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const [name, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (name === key && child != null && child !== '') return path;
    const deeper = search(child, key, path, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

const read = (row, path) =>
  path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    if (key.endsWith('[]')) {
      const list = value[key.slice(0, -2)];
      return Array.isArray(list) ? list[0] : undefined;
    }
    return value[key];
  }, row);

/** The filter kinds, and how each turns a displayed value into a query value. */
const asQuery = {
  text: (v) => String(v),
  name: (v) => String(v),
  exact: (v) => String(v),
  list: (v) => (Array.isArray(v) ? v[0] : v),
  number: (v) => String(v),
  date: (v) => String(v).slice(0, 10),
  presence: (v) => (Array.isArray(v) ? (v.length ? 'any' : 'none') : v > 0 ? 'any' : 'none'),
  boolean: (v) => String(Boolean(v)),
};

const superAdmin = await login('super@healthemr.test', 'Super!2026');
const admin = await login('admin@joeymed.test', 'Admin!2026');
const pharmacy = await login('rx@firstchoice.test', 'Pharmacy!2026');

const ENDPOINTS = [
  ['super-admin/visits', superAdmin, { patient: 'name', email: 'text', phone: 'text', tenant: 'text', category: 'exact', requestStatus: 'exact', provider: 'name', patientState: 'exact', reason: 'text', masterId: 'text', shipment: 'exact', tracking: 'text', charge: 'number', createdAt: 'date', decidedAt: 'date', updatedAt: 'date' }],
  ['super-admin/prescriptions', superAdmin, { medication: 'text', patient: 'name', email: 'text', phone: 'text', patientState: 'exact', tenant: 'text', prescriber: 'name', licence: 'text', masterId: 'text', shipment: 'exact', tracking: 'text', invoice: 'presence', invoiceNumber: 'text', signedAt: 'date', createdAt: 'date', updatedAt: 'date' }],
  ['super-admin/patients', superAdmin, { mrn: 'text', lastName: 'name', email: 'text', phone: 'text', residenceState: 'exact', sexAtBirth: 'exact', accounts: 'text', visits: 'presence', prescriptions: 'presence', allergies: 'presence', createdAt: 'date' }],
  ['super-admin/providers', superAdmin, { lastName: 'name', email: 'text', npi: 'text', states: 'list', categories: 'list', assignedAdmin: 'text' }],
  ['super-admin/pharmacies/directory', superAdmin, { name: 'text', slug: 'text', integrationType: 'exact', assignedAdmin: 'text', categories: 'list', medicationCount: 'presence', tenantCount: 'presence' }],
  ['super-admin/admins', superAdmin, { name: 'text', owner: 'text', email: 'text', phone: 'text', slug: 'text', patients: 'presence', providers: 'presence', pharmacies: 'presence', createdAt: 'date' }],
  ['super-admin/invoices', superAdmin, { number: 'text', tenant: 'text', patient: 'name', totalCents: 'number', issuedAt: 'date', dueAt: 'date', paidAt: 'date', lines: 'presence', payments: 'presence', createdAt: 'date' }],
  ['super-admin/activity', superAdmin, { actor: 'name', tenant: 'text', entity: 'exact', ip: 'text', sequence: 'number', createdAt: 'date' }],
  ['super-admin/medications', superAdmin, { favouriteName: 'text', pharmacy: 'text', category: 'text', strength: 'text', dispense: 'text', medId: 'text', kitCode: 'text', defaultSig: 'text', daysSupply: 'number', costOfGoodsCents: 'number', sell: 'number', refills: 'number', notes: 'text', visitType: 'text', createdAt: 'date', updatedAt: 'date' }],
  ['super-admin/onboarding/providers', superAdmin, { lastName: 'name', email: 'text', npi: 'text', states: 'list', categories: 'list', documents: 'presence', createdAt: 'date' }],
  ['super-admin/onboarding/pharmacies', superAdmin, { legalName: 'text', contactEmail: 'text', integrationType: 'exact', statesServed: 'list', categorySlugs: 'list', documents: 'presence', createdAt: 'date' }],
  ['admin/visits', admin, { masterId: 'text', patient: 'name', category: 'exact', requestStatus: 'exact', provider: 'name', patientState: 'exact', reason: 'text', shipment: 'exact', tracking: 'text', createdAt: 'date', decidedAt: 'date', updatedAt: 'date' }],
  ['admin/prescriptions', admin, { medication: 'text', patient: 'name', prescriber: 'name', licence: 'text', masterId: 'text', shipment: 'exact', tracking: 'text', invoice: 'presence', invoiceNumber: 'text', signedAt: 'date', createdAt: 'date', updatedAt: 'date' }],
  ['admin/patients', admin, { mrn: 'text', lastName: 'name', email: 'text', phone: 'text', residenceState: 'exact', sexAtBirth: 'exact', visits: 'presence', prescriptions: 'presence', allergies: 'presence', createdAt: 'date' }],
  ['dispensary/orders', pharmacy, { medication: 'text', patient: 'name', phone: 'text', prescriber: 'name', directions: 'text', orderId: 'text', tracking: 'text', shipTo: 'text', patientState: 'exact', daysSupply: 'number', dose: 'text', createdAt: 'date', submittedAt: 'date', signedAt: 'date' }],
];

const get = async (path, token, query = '') => {
  const r = await fetch(`${API}/v1/${path}?pageSize=50${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${path}${query}`);
  return (await r.json()).data ?? [];
};

let passed = 0;
const wrong = [];
const unexercised = [];

for (const [path, token, filters] of ENDPOINTS) {
  if (!token) {
    console.log(`\n${path} — no account`);
    continue;
  }

  const rows = await get(path, token);
  if (!rows.length) {
    for (const key of Object.keys(filters)) unexercised.push(`${path}?${key} — no rows`);
    console.log(`\n${path} — no rows to round-trip`);
    continue;
  }

  let ok = 0;
  const local = [];
  for (const [key, kind] of Object.entries(filters)) {
    // A row that actually has something in this column. Others tell us nothing.
    let source = key;
    const row = rows.find((candidate) => {
      const path = locate(candidate, key);
      const value = read(candidate, path);
      if (value == null || value === '') return false;
      if (Array.isArray(value) && !value.length) return false;
      source = path;
      return true;
    });

    if (!row) {
      unexercised.push(`${path}?${key} — every row is empty at ${source}`);
      continue;
    }

    const value = asQuery[kind](read(row, source));
    const returned = await get(path, token, `&${key}=${encodeURIComponent(value)}`).catch(
      (error) => error,
    );
    if (returned instanceof Error) {
      local.push(`${key}=${value} → ${returned.message}`);
      continue;
    }
    if (returned.some((candidate) => candidate.id === row.id)) {
      ok += 1;
      passed += 1;
    } else {
      local.push(`${key}=${JSON.stringify(value)} lost the row it came from`);
    }
  }

  console.log(`\n${local.length ? '✗' : '✓'} ${path}  (${ok}/${Object.keys(filters).length})`);
  for (const failure of local) {
    console.log(`    ${failure}`);
    wrong.push(`${path}: ${failure}`);
  }
}

console.log(`\n${passed} filters returned the row they were given`);
if (unexercised.length) {
  console.log(`\n${unexercised.length} could not be exercised (no data, not a failure):`);
  for (const line of unexercised) console.log(`    ${line}`);
}
if (wrong.length) {
  console.log(`\n${wrong.length} FILTERS ARE WRONG`);
  process.exit(1);
}
