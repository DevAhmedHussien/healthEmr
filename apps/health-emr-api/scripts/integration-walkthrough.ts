/**
 * The whole thing, once, against a running stack.
 *
 * A platform owner issues a client business an API key. The client's backend
 * uses it to post a visit. A clinician reads the chart and signs. The pharmacy
 * fills and ships. The patient is told at every step. Then the key is withdrawn
 * and the same request stops working.
 *
 * Every assertion is about something a person would notice, so a failure here
 * names a broken promise rather than a broken selector. Run it after any change
 * to intake, routing, prescribing or fulfilment:
 *
 *   node scripts/integration-walkthrough.mjs
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const API = process.env.API_URL ?? 'http://localhost:4000';

const STAFF = {
  superAdmin: { email: 'super@healthemr.test', password: 'Super!2026' },
  pharmacy: { email: 'rx@firstchoice.test', password: 'Pharmacy!2026' },
};

let failures = 0;
let step = 0;
const gaps: string[] = [];

const ok = (label: string, passed: boolean, detail?: string) => {
  console.log(`  ${passed ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
};
const section = (title: string) => console.log(`\n${++step}. ${title}`);

/**
 * Something that does not work and is not a regression.
 *
 * Reported loudly but kept out of the exit code, so this script stays usable as
 * a regression check while still refusing to imply the gap has been closed.
 */
const gap = (label: string, closed: boolean, detail: string) => {
  if (closed) {
    console.log(`  ✓ ${label}`);
    return;
  }
  console.log(`  ⚠ ${label} — ${detail}`);
  gaps.push(label);
};

interface CallOptions {
  token?: string | null;
  method?: string;
  body?: unknown;
  expect?: number;
}

/**
 * A response body is whatever the endpoint returns, and this script's job is to
 * assert on it rather than to restate every contract in the codebase — the
 * OpenAPI document already does that. `any` here keeps the assertions readable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(
  path: string,
  { token, method = 'GET', body, expect }: CallOptions = {},
): Promise<{ status: number; payload: any }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);

  if (expect !== undefined && response.status !== expect) {
    throw new Error(
      `${method} ${path} returned ${response.status}, expected ${expect} — ${JSON.stringify(payload)?.slice(0, 200)}`,
    );
  }
  return { status: response.status, payload };
}

const login = async (who: keyof typeof STAFF) =>
  (await call('/v1/auth/login', { method: 'POST', body: STAFF[who], expect: 200 })).payload.tokens
    .accessToken;

// A different patient every run, so nothing is ever a stale record from before.
const stamp = `${Date.now()}`.slice(-8);

/** Filled in once the catalogue has been read. */
let chosenProduct: any = null;
let chosenPharmacyId = '';

/**
 * A submission that would succeed.
 *
 * Shared by the real visit and by the probes that change one thing about it, so
 * a refusal is always attributable to the thing that was changed.
 */
function visitBody({ company, masterId }: { company: string; masterId: string }) {
  return {
    company,
    visitType: 'ED',
    pharmacyId: chosenPharmacyId,
    masterId,
    formObj: {
      consentsSigned: true,
      firstName: 'Marcus',
      lastName: `Okonkwo${stamp.slice(-4)}`,
      dob: '11/02/1984',
      sex: 'Male',
      phone: `512555${stamp.slice(-4)}`,
      email: `walkthrough.${stamp}@example.test`,
      address: '400 Guadalupe St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      allergies: 'None known',
      medicalConditions: 'None',
      selfReportedMeds: 'None',
      Q1: 'How long have you had difficulty with erections?',
      A1: 'About eight months.',
      Q2: 'Do you have heart disease or take nitrates?',
      A2: 'No.',
      Q3: 'What is your blood pressure, if you know it?',
      A3: '124/78',
      patientPreference: [
        {
          name: chosenProduct?.name ?? 'Sildenafil Citrate Oral Tablet',
          strength: chosenProduct?.strength ?? '100 MG',
          quantity: chosenProduct?.dispenseQuantity ?? '10',
          refills: String(chosenProduct?.refills ?? 0),
          daysSupply: String(chosenProduct?.daysSupply ?? 30),
          medId: chosenProduct?.medId ?? '',
          patientPaidCents: 14900,
        },
      ],
    },
  };
}

async function main() {
  // ── 1 ────────────────────────────────────────────────────────────────────
  section('The platform issues a client business its credentials');

  const owner = await login('superAdmin');
  const { payload: clients } = await call('/v1/super-admin/admins?pageSize=50', { token: owner });
  const client = clients.data.find((row: any) => row.slug === 'joeyMed');
  ok('the client account exists', Boolean(client), client?.name);

  const { payload: issued } = await call(`/v1/super-admin/admins/${client.id}/api-keys`, {
    token: owner,
    method: 'POST',
    body: { name: `walkthrough ${stamp}` },
    expect: 201,
  });
  ok('a key is returned, once', issued.key?.startsWith('hemr_'), `hemr_${issued.keyPrefix}…`);
  ok('the company key comes with it', issued.companyKey === 'joeyMed', issued.companyKey);

  const { payload: access } = await call(`/v1/super-admin/admins/${client.id}/api-access`, {
    token: owner,
  });
  ok(
    'the console lists the key without the key',
    access.keys.some((row: any) => row.id === issued.id) &&
      !JSON.stringify(access.keys).includes(issued.key),
  );

  const partner = issued.key;

  // ── 3 ────────────────────────────────────────────────────────────────────
  section('The client reads what it may order');

  const { payload: pharmacies } = await call('/partner/v1/pharmacies', { token: partner });
  const pharmacy =
    pharmacies.data.find((row: any) => /first choice/i.test(row.name)) ?? pharmacies.data[0];
  ok('its contracted pharmacies are listed', Boolean(pharmacy), pharmacy?.name);
  chosenPharmacyId = pharmacy.pharmacyId;

  const { payload: catalogue } = await call(
    `/partner/v1/pharmacies/${pharmacy.pharmacyId}/medications`,
    { token: partner },
  );

  const offered = (visitType: string) =>
    catalogue.data.filter((row: any) => row.visitTypes.includes(visitType));
  for (const visitType of ['weightloss', 'ED', 'hairloss', 'antiAging']) {
    const rows = offered(visitType);
    ok(
      `${visitType} has something to prescribe`,
      rows.length > 0,
      `${rows.length}: ${rows.slice(0, 2).map((row: any) => row.favouriteName).join(', ')}`,
    );
  }
  ok(
    'a follow-up can reorder what it follows up on',
    offered('EDfollowup').length > 0,
    `${offered('EDfollowup').length} products`,
  );
  ok(
    'medIds and kit codes are not the same string',
    catalogue.data.every((row: any) => row.medId !== row.kitId),
  );

  chosenProduct = offered('ED')[0];

  // ── 2 ────────────────────────────────────────────────────────────────────
  section('The credential is what makes a visit attributable');

  // A probe has to be a payload that would otherwise succeed. Schema validation
  // runs before the controller, so an empty body is refused for being empty and
  // proves nothing about who is allowed to send it.
  const probe = (token: string | null | undefined, company: string, masterId = `probe-${stamp}`) =>
    call('/partner/v1/visit/createNoPayPhotos', {
      token,
      method: 'POST',
      body: visitBody({ company, masterId }),
    });

  ok('no token is refused', (await probe(undefined, 'joeyMed')).status === 401);
  ok('a made-up token is refused', (await probe('hemr_notarealkeyatall', 'joeyMed')).status === 401);

  const wrongCompany = await probe(partner, 'acmeHealth');
  ok(
    'a real token claiming another company is refused',
    wrongCompany.payload?.error === 'No company found',
    wrongCompany.payload?.error,
  );

  // ── 4 ────────────────────────────────────────────────────────────────────
  section('A patient submits a sexual health visit');

  const product = chosenProduct;
  const masterId = `walkthrough-${stamp}`;

  const { payload: submitted } = await call('/partner/v1/visit/createNoPayPhotos', {
    token: partner,
    method: 'POST',
    expect: 200,
    body: visitBody({ company: 'joeyMed', masterId }),
  });

  const visitId = submitted.data.visitId;
  ok('the visit is accepted', Boolean(visitId), product.favouriteName);

  const replay = await probe(partner, 'joeyMed', masterId);
  ok(
    'a reused order id is refused',
    replay.payload?.error === 'Duplicate masterId',
    `${replay.status} ${replay.payload?.error}`,
  );

  // ── 4b ───────────────────────────────────────────────────────────────────
  section('The client corrects a typo before anyone has acted on it');

  const corrected = await call(`/partner/v1/visit/${masterId}`, {
    token: partner,
    method: 'PATCH',
    expect: 200,
    body: { address: '401 Guadalupe St', phone: '5125550101' },
  });
  ok(
    'the address and phone are changed',
    corrected.payload?.data?.changed?.length === 2,
    corrected.payload?.data?.changed?.join(', '),
  );

  const notMine = await call(`/partner/v1/visit/does-not-exist-${stamp}`, {
    token: partner,
    method: 'PATCH',
    body: { city: 'Dallas' },
  });
  ok(
    'a masterId that is not theirs is refused',
    notMine.payload?.error === 'No visit found for that masterId',
    notMine.payload?.error,
  );

  const clinicalEdit = await call(`/partner/v1/visit/${masterId}`, {
    token: partner,
    method: 'PATCH',
    body: { A1: 'Actually about two years.' },
  });
  ok('the questionnaire cannot be rewritten', clinicalEdit.status === 400);

  // ── 5 ────────────────────────────────────────────────────────────────────
  section('It reaches a clinician, who reads the chart before deciding');

  const { payload: tracked } = await call(`/partner/v1/visit/${masterId}`, { token: partner });
  ok('the client can follow its own visit', tracked.status === 200, tracked.data?.status);

  const providerEmail = await assignedProviderEmail(visitId);
  ok('it was routed to a licensed clinician', Boolean(providerEmail), providerEmail ?? undefined);

  const clinician = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: providerEmail as string, password: 'Provider!2026' },
      expect: 200,
    })
  ).payload.tokens.accessToken;

  await call(`/v1/clinic/visits/${visitId}/start`, { token: clinician, method: 'POST' });
  const { payload: chart } = await call(`/v1/clinic/visits/${visitId}`, { token: clinician });
  ok(
    'the clinician can read the questionnaire',
    JSON.stringify(chart.questionnaire).includes('eight months'),
    `${chart.questionnaire?.answers?.length ?? 0} answers`,
  );

  const item = chart.requested[0];
  await call(`/v1/clinic/visits/${visitId}/decide`, {
    token: clinician,
    method: 'POST',
    expect: 200,
    body: {
      items: [
        {
          itemId: item.id,
          decision: 'APPROVED',
          dose: '50mg',
          route: 'ORAL',
          frequency: 'as needed before sexual activity',
          daysSupply: '30',
          patientNote:
            'Start with half a tablet. Do not take more than one dose in 24 hours, and stop if you get chest pain.',
          sig: 'Take 50mg by mouth as needed before sexual activity. Do not exceed one dose in 24 hours.',
          approvedStrength: product.strength ?? '100 MG',
          approvedQuantity: '10',
          approvedRefills: '2',
        },
      ],
      note: 'No nitrates, no cardiac history, blood pressure acceptable.',
    },
  });
  ok('the clinician signs', true);

  // ── 6 ────────────────────────────────────────────────────────────────────
  section('The pharmacy fills it and ships');

  const dispensary = await login('pharmacy');
  const { payload: queue } = await call('/v1/dispensary/orders?pageSize=100', { token: dispensary });
  // The fill queue is a clinical worklist, not an order-id index — it carries
  // the patient, not the client's masterId. The surname is unique to this run.
  const order = queue.data.find((row: any) => row.patient?.name?.includes(stamp.slice(-4)));
  ok('the order reached the pharmacy', Boolean(order), order?.status);

  const tracking = `1ZW1X23099${stamp}`;

  if (order) {
    await call(`/v1/dispensary/orders/${order.id}/ship`, {
      token: dispensary,
      method: 'POST',
      expect: 200,
      body: { carrier: 'UPS', trackingNumber: tracking },
    });
    ok('it ships with a tracking number', true, `UPS ${tracking}`);
  }

  // ── 7 ────────────────────────────────────────────────────────────────────
  section('The patient was told, each time, in their own words');

  const patient = await signInAsPatient(visitId, `Walkthrough!${stamp}`);
  ok('an account was created for them', Boolean(patient.token), patient.email);

  const { payload: threads } = await call('/v1/chat/threads', { token: patient.token });
  const thread = threads.data?.[0];
  ok('they have a conversation waiting', Boolean(thread), thread?.subject);

  const { payload: messages } = await call(`/v1/chat/threads/${thread.id}/messages`, {
    token: patient.token,
  });
  const said: string[] = (messages.data ?? []).map((row: any) => row.content ?? '');
  const heard = (pattern: RegExp) => said.some((line) => pattern.test(line));

  ok('that we received it', heard(/have your request|received/i));
  ok('that a clinician wrote a prescription', heard(/prescri/i));
  ok('what the directions actually are', heard(/as needed before sexual activity/i));
  ok("the clinician's own note to them", heard(/half a tablet/i));
  ok('that it went to the pharmacy', heard(/pharmacy/i));
  ok('that it shipped, with the tracking number', heard(new RegExp(tracking)));

  console.log(`\n     the conversation, in order:`);
  said.forEach((line) => console.log(`       · ${line.replace(/\s+/g, ' ').slice(0, 120)}`));

  // Deliberately last, and deliberately failing. Everything above only worked
  // because this script set a password; a real patient has none and is never
  // sent one, so none of those messages can currently be read by the person
  // they were written for.
  gap(
    'the patient could have signed in without our help',
    patient.couldAlreadySignIn,
    'intake sets an unusable password and sends no invite, so nobody can read any of the above. ' +
      'Everything in that section only worked because this script set a password.',
  );

  // ── 8 ────────────────────────────────────────────────────────────────────
  section('Deleting the key stops the integration, and removes the row');

  await call(`/v1/super-admin/admins/${client.id}/api-keys/${issued.id}`, {
    token: owner,
    method: 'DELETE',
  });
  ok('the same request is now refused', (await probe(partner, 'joeyMed')).status === 401);

  const { payload: after } = await call(`/v1/super-admin/admins/${client.id}/api-access`, {
    token: owner,
  });
  ok(
    'it is gone from the list, not greyed out in it',
    !after.keys.some((key: any) => key.id === issued.id),
    `${after.keys.length} keys left`,
  );

  const { payload: trail } = await call(
    `/v1/super-admin/activity?entityType=TenantApiKey&entityId=${issued.id}`,
    { token: owner },
  );
  const actions = (trail.data ?? []).map((entry: any) => entry.action);
  ok(
    'both the issue and the deletion are in the audit trail',
    actions.includes('API_KEY_ISSUED') && actions.includes('API_KEY_REVOKED'),
    actions.join(', '),
  );
  ok('the trail never records the key itself', !JSON.stringify(trail).includes(issued.key));

  const asClient = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@joeymed.test', password: 'Admin!2026' },
      expect: 200,
    })
  ).payload.tokens.accessToken;

  const clientSees = await call('/v1/admin/api-access', { token: asClient });
  ok('a client can see its own keys', clientSees.status === 200, `${clientSees.payload.keys.length} listed`);

  const clientMints = await call('/v1/admin/api-keys', {
    token: asClient,
    method: 'POST',
    body: { name: 'minting my own' },
  });
  ok('a client cannot mint its own', clientMints.status === 404, `HTTP ${clientMints.status}`);

  // ── 9 ────────────────────────────────────────────────────────────────────
  section('A shipped visit cannot be un-counted');

  const refused = await call(`/v1/super-admin/visits/${visitId}`, {
    token: owner,
    method: 'DELETE',
    body: { reason: 'Client asked for this one to be removed after it went out.' },
  });
  ok(
    'withdrawal is refused once the medication has shipped',
    refused.status === 400 && /already shipped/i.test(refused.payload?.message ?? ''),
    refused.payload?.message?.slice(0, 80),
  );
}

/** Who the visit was routed to. Only they can act on it, so only they can sign. */
async function assignedProviderEmail(visitId: string): Promise<string | null> {
  const visit = await prisma.prescriptionRequest.findUnique({
    where: { id: visitId },
    select: { assignedProvider: { select: { user: { select: { email: true } } } } },
  });
  return visit?.assignedProvider?.user?.email ?? null;
}

/**
 * Signs the patient in, the way they cannot yet do for themselves.
 *
 * Intake creates the account with an unusable password and sends no invite, so
 * there is currently no path by which a real patient reaches these messages.
 * That is a genuine gap, not a quirk of this script — it is asserted below so
 * the walkthrough keeps saying so until it is wired. Setting a password here
 * lets the rest of the check read the conversation through the same API a
 * patient eventually will, rather than reaching into the database for it.
 */
async function signInAsPatient(visitId: string, password: string) {
  const visit = await prisma.prescriptionRequest.findUnique({
    where: { id: visitId },
    select: { patient: { select: { userId: true, user: { select: { email: true } } } } },
  });

  const userId = visit?.patient?.userId;
  const email = visit?.patient?.user?.email;
  if (!userId || !email) return { token: null, couldAlreadySignIn: false };

  // Invites only. The account also accrues notifications — one per chat message
  // — but being told there is a message waiting is not the same as being able
  // to open it. An invite is the only thing that lets them set a password.
  const invited = await prisma.userInvite.count({ where: { userId } });

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      isActive: true,
    },
  });

  const { payload } = await call('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    expect: 200,
  });

  return {
    token: payload.tokens.accessToken as string,
    // The account has a password hash, but it is random bytes nobody has ever
    // seen. What would make it reachable is an invite or a credentials email,
    // and neither is sent — so this counts those, not the hash.
    couldAlreadySignIn: invited > 0,
    email,
  };
}

main()
  .catch((error: Error) => {
    console.error(`\n  ✗ ${error.message}`);
    failures += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (gaps.length) {
      console.log(`\nKnown gaps, not regressions:`);
      gaps.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    console.log(failures ? `\n${failures} FAILED` : '\nEvery step worked.');
    process.exit(failures ? 1 : 0);
  });
