/**
 * One patient's whole journey, from Tila Health's checkout to a parcel at the door.
 *
 * Every other check in this repo proves one thing in isolation. This proves the
 * thing the business actually sells: that a person who pays on a client's site
 * ends up with medication, that a clinician saw a real chart before signing for
 * it, that the pharmacy was told, and that the client's own systems heard about
 * each of those moments as they happened.
 *
 * The patient is deliberately the same person every run — Hussien Fathy, on the
 * same phone and date of birth — so a second run exercises the case that
 * actually happens in production: a returning patient, matched to the chart
 * they already have rather than given a second one.
 *
 *   npm run journey:tila
 */
import http from 'node:http';

const API = process.env.API_URL ?? 'http://localhost:4000';
const CATCHER_PORT = Number(process.env.CATCHER_PORT ?? 4601);
const stamp = Date.now().toString(36);

/** Who we are putting through the system. */
const PATIENT = {
  firstName: 'Hussien',
  lastName: 'Fathy',
  email: 'h@f.com',
  // Fixed, because identity is matched on phone and date of birth: changing
  // them would mint a new chart every run and never test the returning case.
  phone: '5125550199',
  dob: '03/14/1990',
  sex: 'Male',
};

const steps = [];
/**
 * Work an earlier run already did.
 *
 * A patient cannot have two visits in a day — the platform refuses the second,
 * which is right, because a second visit for the same person within hours is
 * almost always a double submission. So a re-run picks up the visit he already
 * has, and anything already done to it is reported as done rather than
 * pretended at. Saying "passed" for a step this run never performed would make
 * the whole report worth less than nothing.
 */
const already = [];
let failures = 0;
const step = (n, what, condition, detail) => {
  if (!condition) failures += 1;
  steps.push(`  ${condition ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const heading = (title) => steps.push(`\n${title}`);
const done = (what, detail) => {
  already.push(`  · ${what}${detail ? ` — ${detail}` : ''}`);
  steps.push(`  ◦ ${what} — done on an earlier run, not repeated`);
};

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: res.status, payload };
}

const login = async (email, password) =>
  (await call('/v1/auth/login', { method: 'POST', body: { email, password } })).payload?.tokens
    ?.accessToken;

const settle = (ms = 2500) => new Promise((resolve) => setTimeout(resolve, ms));

// Standing in for Tila's own webhook endpoint.
const heard = [];
const catcher = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      heard.push(JSON.parse(raw));
    } catch {
      heard.push({ unparsed: raw });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((resolve) => catcher.listen(CATCHER_PORT, resolve));

const cleanups = [];
async function report() {
  for (const undo of cleanups) await undo();
  catcher.close();
  console.log(steps.join('\n'));
  if (already.length) {
    console.log('\nAlready complete before this run, verified from the record:');
    console.log(already.join('\n'));
  }
  console.log(
    `\n${steps.filter((line) => line.includes('✓')).length} steps passed, ${failures} failed` +
      (already.length ? `, ${already.length} already complete` : ''),
  );
  console.log(`Tila heard: ${heard.map((event) => event.event).join(' → ') || 'nothing'}`);
  process.exit(failures ? 1 : 0);
}

// ── 1. Tila's credentials ──────────────────────────────────────────────────
heading('1. Tila Health gets its credentials');

const owner = await login('super@healthemr.test', 'Super!2026');
step(1, 'the platform owner can sign in', Boolean(owner));
if (!owner) await report();

const { payload: admins } = await call('/v1/super-admin/admins?pageSize=100', { token: owner });
const tila = (admins?.data ?? []).find((row) => /tila/i.test(row.name ?? ''));
step(1, 'Tila Health is a client business on the platform', Boolean(tila), tila?.slug);
if (!tila) await report();

// Anything this script left behind on an interrupted run, removed first.
const existing = await call(`/v1/super-admin/admins/${tila.id}/webhooks`, { token: owner });
for (const row of Array.isArray(existing.payload) ? existing.payload : (existing.payload?.data ?? [])) {
  if (row.name === 'tila journey') {
    await call(`/v1/super-admin/webhooks/${row.id}`, { token: owner, method: 'DELETE' });
  }
}

const { payload: hook } = await call(`/v1/super-admin/admins/${tila.id}/webhooks`, {
  token: owner,
  method: 'POST',
  body: {
    name: 'tila journey',
    url: `http://127.0.0.1:${CATCHER_PORT}/hook`,
    authToken: `journey-${stamp}-secret`,
    events: [
      'CONSULT_RECEIVED',
      'CONSULT_CONCLUDED',
      'RX_WRITTEN',
      'DOCTOR_CHAT',
      'PHARMACY_ORDER_IN_FULFILLMENT',
      'PHARMACY_ORDER_SHIPPED',
      'PHARMACY_ORDER_DELIVERED',
      'PACKAGE_OUT_FOR_DELIVERY',
      'PACKAGE_DELIVERED',
    ],
  },
});
const hookId = hook?.id ?? hook?.data?.id;
step(1, 'Tila points a webhook at its own systems', Boolean(hookId));
if (hookId) {
  cleanups.push(() => call(`/v1/super-admin/webhooks/${hookId}`, { token: owner, method: 'DELETE' }));
}

const { payload: issued } = await call(`/v1/super-admin/admins/${tila.id}/api-keys`, {
  token: owner,
  method: 'POST',
  body: { name: `tila journey ${stamp}` },
});
const key = issued?.key;
step(1, 'Tila is issued an API key', Boolean(key), key ? `hemr_${issued.keyPrefix}…` : undefined);
if (!key) await report();
cleanups.push(() =>
  call(`/v1/super-admin/admins/${tila.id}/api-keys/${issued.id}`, { token: owner, method: 'DELETE' }),
);

// ── 2. What Tila may sell, and where ───────────────────────────────────────
heading('2. Tila reads what it may sell, and where');

const { payload: coverage } = await call('/partner/v1/coverage', { token: key });
const servable = (coverage?.data ?? []).filter((row) => row.servable);
step(2, 'it learns which states it can actually serve', servable.length > 0, `${servable.length} states`);

const { payload: pharmacies } = await call('/partner/v1/pharmacies', { token: key });
const pharmacy = (pharmacies?.data ?? []).find((row) => row.isDefault) ?? pharmacies?.data?.[0];
step(2, 'its contracted pharmacies are listed', Boolean(pharmacy), pharmacy?.name);
if (!pharmacy) await report();

const { payload: catalogue } = await call(
  `/partner/v1/pharmacies/${pharmacy.pharmacyId}/catalog`,
  { token: key },
);
const rows = catalogue?.data ?? [];
step(2, 'that pharmacy publishes what it carries', rows.length > 0, `${rows.length} products`);

// Whichever treatment area this pharmacy and this client actually share.
const product = rows.find((row) => (row.visitTypes ?? []).length > 0);
const visitType = product?.visitTypes?.[0];
step(2, 'there is something it can prescribe', Boolean(product), `${product?.name} (${visitType})`);
if (!product) await report();

const { payload: form } = await call(`/partner/v1/intake-forms/${visitType}`, { token: key });
const questions = form?.data?.questionnaire?.questions ?? form?.data?.questions ?? [];
step(2, 'the intake questions for it are published', questions.length > 0, `${questions.length} questions`);

// ── 3. Hussien Fathy fills in Tila's form ──────────────────────────────────
heading('3. Hussien Fathy fills in Tila’s form and pays');

const state = servable.find((row) => row.state === 'TX')?.state ?? servable[0]?.state;
const masterId = `TILA-HUSSIEN-${stamp}`;

const answers = {};
questions.slice(0, 3).forEach((question, index) => {
  answers[`Q${index + 1}`] = question.prompt ?? question.text ?? question.label ?? `Question ${index + 1}`;
  answers[`A${index + 1}`] = question.kind === 'BOOLEAN' ? 'No' : 'No, none of these apply.';
});

const visitBody = {
    company: tila.slug,
    visitType,
    pharmacyId: pharmacy.pharmacyId,
    masterId,
    formObj: {
      consentsSigned: true,
      firstName: PATIENT.firstName,
      lastName: PATIENT.lastName,
      dob: PATIENT.dob,
      sex: PATIENT.sex,
      phone: PATIENT.phone,
      email: PATIENT.email,
      address: '401 Congress Ave',
      city: 'Austin',
      state,
      zip: '78701',
      allergies: 'None known',
      medicalConditions: 'None',
      selfReportedMeds: 'None',
      ...answers,
      patientPreference: [
        {
          name: product.name,
          strength: product.strength ?? '—',
          quantity: String(product.dispenseQuantity ?? '1'),
          refills: String(product.refills ?? 0),
          ...(product.daysSupply ? { daysSupply: String(product.daysSupply) } : {}),
          medId: product.medId,
          patientPaidCents: 14900,
        },
      ],
    },
};

const submission = await call('/partner/v1/visits', { token: key, method: 'POST', body: visitBody });

let visitId = submission.payload?.data?.visitId;
let orderId = masterId;
let fresh = true;

if (submission.payload?.error === 'Patient not eligible for new visit') {
  // He already has one open from a previous run. That refusal is the platform
  // doing its job — a second visit for the same person within a day is almost
  // always a double submission, and charging somebody twice for one one complaint is
  // worse than making the client wait. So the journey continues with the visit
  // he actually has, which is what a returning patient looks like in practice.
  fresh = false;
  step(3, 'a second visit within a day is refused, as it should be', true,
    submission.payload.error);

  const { payload: open } = await call('/v1/super-admin/visits?pageSize=100', { token: owner });
  const his = (open?.data ?? []).find(
    (visit) =>
      visit.patient?.name === `${PATIENT.firstName} ${PATIENT.lastName}` &&
      !visit.voidedAt &&
      visit.tenant?.id === tila.id,
  );
  visitId = his?.id;
  orderId = his?.masterId;
  step(3, 'the journey continues with the visit he already has', Boolean(visitId), orderId);
} else {
  step(3, 'the visit is accepted', submission.status === 200 && Boolean(visitId),
    visitId ? `${masterId} in ${state}` : JSON.stringify(submission.payload).slice(0, 220));

  // The same payload again, not a stub: a stub is refused for being invalid and
  // would prove nothing about the order id being reused.
  const replay = await call('/partner/v1/visits', { token: key, method: 'POST', body: visitBody });
  step(3, 'sending the same order id twice is refused',
    replay.payload?.error === 'Duplicate masterId', replay.payload?.error);
}

if (!visitId) await report();

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const upload = await call(`/partner/v1/visits/${visitId}/uploads`, {
  token: key,
  method: 'POST',
  body: { images: [{ mime: 'image/png', data: png }], kind: 'ID_PHOTO' },
});
step(3, 'his ID photograph is attached to the visit', upload.status === 200);

await settle();
if (fresh) {
  step(3, 'Tila is told the visit reached us',
    heard.some((event) => event.event === 'CONSULT_RECEIVED' && event.masterId === orderId));
}

// ── 4. It reaches a clinician ──────────────────────────────────────────────
heading('4. It reaches a clinician licensed where he lives');

const { payload: visits } = await call('/v1/super-admin/visits?pageSize=100', { token: owner });
const row = (visits?.data ?? []).find((visit) => visit.masterId === orderId);
step(4, 'the platform shows the visit against Hussien’s chart', Boolean(row),
  row ? `${row.patient?.name} (${row.patient?.mrn})` : 'not found');
step(4, 'it was routed to a clinician', Boolean(row?.provider), row?.provider);
step(4, 'his name is recorded as he gave it',
  row?.patient?.name === `${PATIENT.firstName} ${PATIENT.lastName}`, row?.patient?.name);

const { payload: staff } = await call('/v1/super-admin/providers?pageSize=100', { token: owner });
const clinicianRow = (staff?.data ?? []).find((person) => person.name === row?.provider);
const clinician = clinicianRow?.email ? await login(clinicianRow.email, 'Provider!2026') : null;
step(4, 'that clinician can sign in', Boolean(clinician), clinicianRow?.email);
if (!clinician) await report();

const { payload: chart } = await call(`/v1/clinic/visits/${visitId}`, { token: clinician });
// On a shared visit a clinician decides only the lines that are theirs.
const items = (chart?.requested ?? []).filter((line) => line.mine);
step(4, 'they can open the chart before deciding', items.length > 0,
  `${items.length} line(s), ${(chart?.questionnaire?.answers ?? []).length} answers, ${(chart?.photos ?? []).length} photo(s)`);
step(4, 'the photograph he uploaded is on the chart', (chart?.photos ?? []).length > 0);

// ── 5. The clinician asks him something ────────────────────────────────────
heading('5. The clinician asks him a question, and he answers from Tila’s site');

const question = `Before I sign this — are you taking anything else at the moment? (${stamp})`;
const { status: askStatus, payload: thread } = await call('/v1/chat/threads', {
  token: clinician,
  method: 'POST',
  body: { kind: 'PATIENT_PROVIDER', patientId: row.patient.id, message: question },
});
const threadId = thread?.threadId ?? thread?.id;
step(5, 'the clinician can write to him', Boolean(threadId) && askStatus < 300,
  threadId ? undefined : JSON.stringify(thread).slice(0, 200));

await settle();
step(5, 'Tila receives it as DOCTOR_CHAT, so it shows in their portal',
  heard.some((event) => event.event === 'DOCTOR_CHAT' && event.content === question));

const reply = `No nitrates, nothing at all. (${stamp})`;
const answered = await call(`/partner/v1/visits/${orderId}/messages`, {
  token: key,
  method: 'POST',
  body: { apiKey: key, content: reply, image: { content: png, mime: 'image/png', fileName: 'id.png' } },
});
step(5, 'he answers on Tila’s site and it reaches us', answered.status === 200,
  answered.status === 200
    ? answered.payload?.status
    : `${answered.status} ${JSON.stringify(answered.payload).slice(0, 200)}`);

const { payload: conversation } = await call(`/v1/chat/threads/${threadId}/messages`, {
  token: clinician,
});
const messages = conversation?.data ?? [];
step(5, 'the clinician sees his answer', messages.some((m) => m.content === reply));
step(5, 'and the photograph he sent with it',
  messages.some((m) => (m.attachments ?? []).length > 0));
step(5, 'his words are recorded as his, not as Tila’s',
  messages.find((m) => m.content === reply)?.authorRole === 'PATIENT',
  messages.find((m) => m.content === reply)?.author);

// ── 6. The decision ────────────────────────────────────────────────────────
heading('6. The clinician prescribes');

const undecided = items.filter((line) => line.decision === 'PENDING');
if (!undecided.length) {
  done('the clinician prescribed', items.map((line) => `${line.name}: ${line.decision}`).join(', '));
  const { payload: soFar } = await call(`/partner/v1/visits/${orderId}`, { token: key });
  step(6, 'the record shows a prescription was written for him',
    (soFar?.data?.rxHistory ?? []).length > 0, soFar?.data?.rxHistory?.[0]?.name);
}

const decision = undecided.length
  ? await (async () => {
      await call(`/v1/clinic/visits/${visitId}/start`, { token: clinician, method: 'POST' });
      return call(`/v1/clinic/visits/${visitId}/decide`, {
        token: clinician,
        method: 'POST',
        body: {
          // Only the lines still awaiting a decision.
          items: undecided.map((item) => ({
            itemId: item.id,
            decision: 'APPROVED',
            sig: 'Take one tablet by mouth daily.',
            dose: product.strength ?? '1 MG',
            route: 'ORAL',
            frequency: 'once daily',
            patientNote:
              'Take one tablet each day, at whatever time you will remember. Give it a few months.',
            approvedStrength: product.strength ?? '1 MG',
            approvedQuantity: String(product.dispenseQuantity ?? '1'),
            approvedRefills: String(product.refills ?? 0),
            ...(product.daysSupply ? { daysSupply: String(product.daysSupply) } : {}),
          })),
          note: 'Answers reviewed, no contraindications reported.',
        },
      });
    })()
  : null;

if (decision) {
  step(6, 'the decision is accepted', decision.status === 200 || decision.status === 201,
    decision.payload?.status ?? JSON.stringify(decision.payload).slice(0, 200));
  step(6, 'a prescription was written',
    (decision.payload?.prescriptionIds ?? []).length > 0,
    `${(decision.payload?.prescriptionIds ?? []).length} prescription(s)`);

  await settle(3500);
  step(6, 'Tila is told the consultation concluded',
    heard.some((e) => e.event === 'CONSULT_CONCLUDED' && e.masterId === orderId),
    heard.find((e) => e.event === 'CONSULT_CONCLUDED')?.visitOutcome);
  step(6, 'and what was prescribed',
    heard.some((e) => e.event === 'RX_WRITTEN' && e.masterId === orderId),
    heard.find((e) => e.event === 'RX_WRITTEN')?.medsPrescribed?.[0]?.name);
}

// ── 7. The pharmacy ────────────────────────────────────────────────────────
heading('7. The pharmacy fills it and posts it');

const pharmacyToken = await login('rx@firstchoice.test', 'Pharmacy!2026');
step(7, 'the pharmacy can sign in', Boolean(pharmacyToken));

const findOrder = async (statuses) => {
  for (const status of statuses) {
    const { payload: queue } = await call(`/v1/dispensary/orders?pageSize=100&status=${status}`, {
      token: pharmacyToken,
    });
    const hit = (queue?.data ?? []).find((candidate) => candidate.patient?.mrn === row.patient.mrn);
    if (hit) return { ...hit, queue: status };
  }
  return null;
};

let order = pharmacyToken
  ? await findOrder(['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'])
  : null;

if (!order && pharmacyToken) {
  const gone = await findOrder(['SHIPPED', 'DELIVERED']);
  if (gone) {
    done(`the pharmacy filled and posted it`, `${gone.medication}, ${gone.queue.toLowerCase()}`);
    step(7, 'the record shows the carrier and tracking number',
      Boolean(gone.carrier && gone.trackingNumber), `${gone.carrier} ${gone.trackingNumber}`);
  } else {
    step(7, 'his order reached the pharmacy', false, 'not in any queue');
  }
} else {
  step(7, 'his order is in their queue', Boolean(order), order?.medication);
}

if (order) {
  const tracking = `7709${Date.now().toString().slice(-8)}`;
  const shipped = await call(`/v1/dispensary/orders/${order.id}/ship`, {
    token: pharmacyToken,
    method: 'POST',
    body: { carrier: 'FEDEX', trackingNumber: tracking },
  });
  step(7, 'they record the carrier and tracking number', shipped.status === 200, tracking);

  await settle();
  step(7, 'Tila is told it shipped',
    heard.some((e) => e.event === 'PHARMACY_ORDER_SHIPPED' && e.masterId === orderId));

  const out = await call(`/v1/dispensary/orders/${order.id}/tracking`, {
    token: pharmacyToken,
    method: 'POST',
    body: { status: 'PACKAGE_OUT_FOR_DELIVERY', trackerStatus: 'On vehicle for delivery' },
  });
  step(7, 'they report it is out for delivery', out.status === 200);

  const unexplained = await call(`/v1/dispensary/orders/${order.id}/tracking`, {
    token: pharmacyToken,
    method: 'POST',
    body: { status: 'PACKAGE_DELIVERY_FAILED' },
  });
  step(7, 'a failed delivery with no explanation is refused', unexplained.status === 400);

  const delivered = await call(`/v1/dispensary/orders/${order.id}/tracking`, {
    token: pharmacyToken,
    method: 'POST',
    body: { status: 'PACKAGE_DELIVERED' },
  });
  step(7, 'they report it arrived', delivered.status === 200);

  await settle(3500);
  step(7, 'Tila hears it is out for delivery',
    heard.some((e) => e.event === 'PACKAGE_OUT_FOR_DELIVERY' && e.masterId === orderId));
  step(7, 'and that it was delivered',
    heard.some((e) => e.event === 'PACKAGE_DELIVERED' && e.masterId === orderId));
  step(7, 'with the carrier and tracking number on it',
    heard.find((e) => e.event === 'PACKAGE_DELIVERED')?.info?.tracking === tracking);
}

// ── 8. What Tila can see afterwards ────────────────────────────────────────
heading('8. Tila can read the whole visit back');

const { payload: final } = await call(`/partner/v1/visits/${orderId}`, { token: key });
step(8, 'the visit reads back by Tila’s own order id', final?.masterId === orderId, orderId);
step(8, 'it carries his name', final?.data?.formObj?.firstName === PATIENT.firstName,
  `${final?.data?.formObj?.firstName} ${final?.data?.formObj?.lastName}`);
step(8, 'it shows the prescription that was written',
  (final?.data?.rxHistory ?? []).length > 0,
  final?.data?.rxHistory?.[0]?.name);
step(8, 'and the photograph he uploaded', (final?.uploads ?? []).length > 0);
step(8, 'the status is one Tila can act on', Boolean(final?.visitStatus), final?.visitStatus);

const retired = await call(`/partner/v1/visit/externalFetch/${orderId}`, { token: key });
step(8, 'an integration still on the old path is not broken', retired.status === 200);

await report();
