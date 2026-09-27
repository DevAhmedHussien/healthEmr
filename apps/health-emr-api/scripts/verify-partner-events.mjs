/**
 * Does anything actually cross the boundary?
 *
 * A client business and this platform are two systems that only ever see each
 * other through the partner API and a webhook. Everything in here is a claim
 * that reads as true in the code and is worth nothing until something has
 * actually been sent and something has actually arrived: a patient typing on
 * their telehealth brand's site and a clinician reading it here; a clinician
 * replying and the client's CRM being told; a pharmacy reporting a parcel and
 * both of them finding out.
 *
 * Run against a seeded database with the API up:
 *   npm run verify:partner-events
 *
 * It creates a webhook pointed at a local listener and a tenant API key, and
 * removes both afterwards. The conversation it starts is left in place — it is
 * a real conversation on a real visit, and deleting clinical messages to tidy
 * up after a test is not a thing this system should be able to do.
 */
import http from 'node:http';

const API = process.env.API_URL ?? 'http://localhost:4000';
const CATCHER_PORT = Number(process.env.CATCHER_PORT ?? 4599);

const pass = [];
const fail = [];
/**
 * Things this run could not exercise, reported rather than passed over.
 *
 * A check that needs a parcel in transit cannot run when the client has none,
 * and neither a tick nor a cross would be true. Silence would be worse than
 * both: a green run would read as proof of something nobody tested.
 */
const skipped = [];
const ok = (what, cond, detail) =>
  (cond ? pass : fail).push(`${cond ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
const skip = (what, why) => skipped.push(`⚠ ${what} — ${why}`);

async function call(path, { token, method = 'GET', body, expect } = {}) {
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
  if (expect && res.status !== expect) {
    console.error(`  ! ${method} ${path} → ${res.status}`, JSON.stringify(payload).slice(0, 400));
  }
  return { status: res.status, payload };
}

const login = async (email, password) =>
  (await call('/v1/auth/login', { method: 'POST', body: { email, password } })).payload?.tokens
    ?.accessToken;

// Somewhere for the webhooks to land, standing in for the client's endpoint.
const caught = [];
const catcher = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      caught.push(JSON.parse(raw));
    } catch {
      caught.push({ unparsed: raw });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((resolve) => catcher.listen(CATCHER_PORT, resolve));

const finish = async (cleanup) => {
  await cleanup?.();
  catcher.close();
  console.log('\n' + [...pass, ...fail].join('\n'));
  if (skipped.length) console.log('\nNot exercised by this run:\n' + skipped.join('\n'));
  console.log(
    `\n${pass.length} passed, ${fail.length} failed` +
      (skipped.length ? `, ${skipped.length} not exercised` : ''),
  );
  process.exit(fail.length ? 1 : 0);
};

const owner = await login('super@healthemr.test', 'Super!2026');
ok('signed in as the platform owner', Boolean(owner));
if (!owner) await finish();

const { payload: admins } = await call('/v1/super-admin/admins?pageSize=100', { token: owner });
const clients = admins?.data ?? [];
const client = clients.find((row) => /tila/i.test(row.name ?? '')) ?? clients[0];
ok('found a client business to act as', Boolean(client), client?.name);
if (!client) await finish();

// A visit of theirs that a clinician is actually holding: without one there is
// no conversation for a patient's message to join.
const { payload: visits } = await call('/v1/super-admin/visits?pageSize=100', { token: owner });
const theirs = (visits?.data ?? []).filter(
  (row) => row.tenant?.id === client.id && row.provider && !row.voidedAt,
);
const visit = theirs[0];
ok(
  'found one of their visits with a clinician on it',
  Boolean(visit),
  visit ? `${visit.masterId} held by ${visit.provider}` : 'none — seed one first',
);
if (!visit) await finish();

const masterId = visit.masterId;

const EVENTS = [
  'DOCTOR_CHAT',
  'PACKAGE_IN_TRANSIT',
  'PACKAGE_OUT_FOR_DELIVERY',
  'PACKAGE_DELIVERED',
  'PACKAGE_DELIVERY_FAILED',
  'PHARMACY_ORDER_DELIVERED',
  'NAME_UPDATE',
];

const LISTENER_NAME = 'partner event check';
const hookIds = [];

/**
 * Point a webhook at the local listener for one client.
 *
 * Anything this check left behind on an earlier run is removed first. A run
 * that is interrupted cannot clean up after itself, and the webhook it leaves
 * has the same URL as the one the next run wants — so without this, one crash
 * makes every later run fail on a duplicate while the stale listener quietly
 * keeps delivering, which looks exactly like the feature being broken.
 */
async function listenFor(clientId) {
  const existing = await call(`/v1/super-admin/admins/${clientId}/webhooks`, { token: owner });
  const rows = Array.isArray(existing.payload) ? existing.payload : (existing.payload?.data ?? []);
  for (const row of rows) {
    if (row.name === LISTENER_NAME) {
      await call(`/v1/super-admin/webhooks/${row.id}`, { token: owner, method: 'DELETE' });
    }
  }

  const { payload } = await call(`/v1/super-admin/admins/${clientId}/webhooks`, {
    token: owner,
    method: 'POST',
    body: {
      name: LISTENER_NAME,
      url: `http://127.0.0.1:${CATCHER_PORT}/hook`,
      authToken: 'check-token',
      events: EVENTS,
    },
    expect: 201,
  });
  const id = payload?.id ?? payload?.data?.id;
  if (id) hookIds.push(id);
  return id;
}

const hookId = await listenFor(client.id);
ok('a webhook can be pointed at these events', Boolean(hookId));

const { payload: issued } = await call(`/v1/super-admin/admins/${client.id}/api-keys`, {
  token: owner,
  method: 'POST',
  body: { name: `partner event check ${Date.now()}` },
  expect: 201,
});
const partnerKey = issued?.key;
ok('a tenant API key was issued', Boolean(partnerKey));

const cleanup = async () => {
  for (const id of hookIds) {
    await call(`/v1/super-admin/webhooks/${id}`, { token: owner, method: 'DELETE' });
  }
  if (issued?.id) {
    await call(`/v1/super-admin/admins/${client.id}/api-keys/${issued.id}`, {
      token: owner,
      method: 'DELETE',
    });
  }
};

// ── inbound: the patient writes from the client's own portal ────────────────
const sentence = `Is it normal to feel tired on this? (${Date.now()})`;
const inbound = await call(`/partner/v1/visits/${masterId}/messages`, {
  token: partnerKey,
  method: 'POST',
  body: { apiKey: partnerKey, content: sentence },
  expect: 200,
});
const threadId = inbound.payload?.threadId;
ok(
  'the patient’s message is accepted',
  inbound.status === 200 && Boolean(threadId),
  inbound.payload?.status ?? JSON.stringify(inbound.payload).slice(0, 200),
);

// A 1×1 PNG, standing in for the photograph a clinician asked for.
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const withImage = await call(`/partner/v1/visits/${masterId}/messages`, {
  token: partnerKey,
  method: 'POST',
  body: { apiKey: partnerKey, image: { content: png, mime: 'image/png', fileName: 'site.png' } },
  expect: 200,
});
ok(
  'a photograph is accepted too',
  withImage.status === 200 && Boolean(withImage.payload?.attachmentId),
  withImage.payload?.attachmentId,
);
ok('both land in the same conversation', withImage.payload?.threadId === threadId);

const notMine = await call(`/partner/v1/visits/no-such-visit-${Date.now()}/messages`, {
  token: partnerKey,
  method: 'POST',
  body: { apiKey: partnerKey, content: 'hello?' },
});
ok('a masterId that is not theirs is refused', notMine.status === 404, notMine.payload?.message);

const empty = await call(`/partner/v1/visits/${masterId}/messages`, {
  token: partnerKey,
  method: 'POST',
  body: { apiKey: partnerKey },
});
ok('a message with nothing in it is refused', empty.status === 400);

// ── the clinician's side ────────────────────────────────────────────────────
const { payload: staff } = await call('/v1/super-admin/providers?pageSize=100', { token: owner });
const match = (staff?.data ?? []).find((row) => row.name === visit.provider);
const clinician = match?.email ? await login(match.email, 'Provider!2026') : null;
ok('signed in as the clinician holding the visit', Boolean(clinician), match?.email);

if (clinician && threadId) {
  const { payload: thread } = await call(`/v1/chat/threads/${threadId}/messages`, {
    token: clinician,
  });
  const messages = thread?.data ?? [];
  ok(
    'the clinician can see what the patient wrote',
    messages.some((message) => message.content === sentence),
    `${messages.length} messages in the thread`,
  );
  ok(
    'the photograph is there as an attachment',
    messages.some((message) => (message.attachments ?? []).length > 0),
  );
  // The client business is not a participant in a clinical conversation, and a
  // transcript that said otherwise would mislead whoever reads it back.
  ok(
    'the patient’s words are attributed to the patient',
    messages.find((message) => message.content === sentence)?.authorRole === 'PATIENT',
    messages.find((message) => message.content === sentence)?.author,
  );

  // ── outbound: the clinician replies ──────────────────────────────────────
  const reply = `Some tiredness is expected in the first fortnight. (${Date.now()})`;
  const sent = await call(`/v1/chat/threads/${threadId}/messages`, {
    token: clinician,
    method: 'POST',
    body: { content: reply },
  });
  ok('the clinician can reply', sent.status === 200 || sent.status === 201);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const doctorChat = caught.find((row) => row.event === 'DOCTOR_CHAT' && row.content === reply);
  ok(
    'DOCTOR_CHAT reached the client',
    Boolean(doctorChat),
    doctorChat ? undefined : `caught: ${caught.map((row) => row.event).join(', ') || 'nothing'}`,
  );
  ok('it is addressed by the client’s own order id', doctorChat?.masterId === masterId, masterId);
  // Otherwise the client's CRM shows the patient's own message as the doctor's.
  ok(
    'the patient’s message is not echoed back to them as the doctor’s',
    !caught.some((row) => row.event === 'DOCTOR_CHAT' && row.content === sentence),
  );
}

// ── the parcel: where it got to, reported by the pharmacy ───────────────────
const pharmacy = await login('rx@firstchoice.test', 'Pharmacy!2026');
ok('signed in as the pharmacy', Boolean(pharmacy));

if (pharmacy) {
  // Subscriptions are per client, so the event only arrives if the webhook is
  // registered against whoever owns the parcel. That need not be the client we
  // had the conversation with — one may have a patient writing in while another
  // has something in the post — so the parcel is found first and the listener
  // follows it.
  const everyVisit = [];
  for (let page = 1; page <= 3; page += 1) {
    const { payload } = await call(`/v1/super-admin/visits?pageSize=100&page=${page}`, {
      token: owner,
    });
    everyVisit.push(...(payload?.data ?? []));
    if (page >= (payload?.pageInfo?.totalPages ?? 1)) break;
  }

  const shippable = ['SHIPPED', 'QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'];
  const parcelVisit = everyVisit
    .filter((row) => shippable.includes(row.shipment?.status))
    .sort((a, b) => shippable.indexOf(a.shipment.status) - shippable.indexOf(b.shipment.status))[0];

  const parcelClient = parcelVisit?.tenant;
  if (parcelClient && parcelClient.id !== client.id) await listenFor(parcelClient.id);

  const inQueue = async (status) =>
    (await call(`/v1/dispensary/orders?pageSize=100&status=${status}`, { token: pharmacy })).payload
      ?.data ?? [];

  const mrn = parcelVisit?.patient?.mrn;
  let shipped = (await inQueue('SHIPPED')).find((order) => order.patient?.mrn === mrn);
  if (!shipped && mrn) {
    // Nothing of theirs in transit — including because a previous run of this
    // check delivered the last one. A check that only passes the first time it
    // is run is not a check, so it ships one itself.
    const waiting = (
      await Promise.all(['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'].map(inQueue))
    )
      .flat()
      .find((order) => order.patient?.mrn === mrn);
    if (waiting) {
      const sent = await call(`/v1/dispensary/orders/${waiting.id}/ship`, {
        token: pharmacy,
        method: 'POST',
        body: { carrier: 'FEDEX', trackingNumber: `7709${Date.now().toString().slice(-8)}` },
        expect: 200,
      });
      if (sent.status === 200) {
        shipped = { ...waiting, trackingNumber: sent.payload?.trackingNumber };
      }
    }
  }

  if (shipped) {
    ok('found a parcel to track', true, `${shipped.trackingNumber} for ${parcelClient?.name}`);
  } else {
    skip(
      'the tracking events (PACKAGE_*, PHARMACY_ORDER_DELIVERED)',
      'no client has a parcel in transit or waiting to ship; seed a visit through to a pharmacy order and run again',
    );
  }

  if (shipped) {
    const before = caught.length;

    const moved = await call(`/v1/dispensary/orders/${shipped.id}/tracking`, {
      token: pharmacy,
      method: 'POST',
      body: { status: 'PACKAGE_OUT_FOR_DELIVERY', trackerStatus: 'On vehicle for delivery' },
      expect: 200,
    });
    ok('the pharmacy can report it is out for delivery', moved.status === 200);

    const unexplained = await call(`/v1/dispensary/orders/${shipped.id}/tracking`, {
      token: pharmacy,
      method: 'POST',
      body: { status: 'PACKAGE_DELIVERY_FAILED' },
    });
    ok(
      'a failed delivery with no explanation is refused',
      unexplained.status === 400,
      unexplained.payload?.details?.[0]?.message,
    );

    const delivered = await call(`/v1/dispensary/orders/${shipped.id}/tracking`, {
      token: pharmacy,
      method: 'POST',
      body: { status: 'PACKAGE_DELIVERED' },
      expect: 200,
    });
    ok('the pharmacy can report it arrived', delivered.status === 200);

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const fresh = caught.slice(before);
    ok(
      'PACKAGE_OUT_FOR_DELIVERY reached the client',
      fresh.some((row) => row.event === 'PACKAGE_OUT_FOR_DELIVERY'),
      fresh.map((row) => row.event).join(', ') || 'nothing',
    );
    ok('PACKAGE_DELIVERED reached the client', fresh.some((row) => row.event === 'PACKAGE_DELIVERED'));
    // Sent alongside, so a client subscribed to the order lifecycle does not
    // have to learn the tracking vocabulary to find out an order finished.
    ok(
      'PHARMACY_ORDER_DELIVERED was sent alongside it',
      fresh.some((row) => row.event === 'PHARMACY_ORDER_DELIVERED'),
    );

    const tracked = fresh.find((row) => row.event === 'PACKAGE_DELIVERED');
    ok(
      'it carries the carrier and tracking number',
      Boolean(tracked?.info?.tracking && tracked?.info?.carrier),
      tracked ? `${tracked.info.carrier} ${tracked.info.tracking}` : undefined,
    );
    // No carrier-tracking provider is connected, and saying so is better than
    // inventing a value a support desk would then rely on.
    ok('what we cannot know is null rather than invented', tracked?.info?.trackingUrl === null);
  }
}

// ── a name corrected here, corrected there ─────────────────────────────────
const { payload: chart } = await call(`/v1/super-admin/patients/${visit.patient.id}`, {
  token: owner,
});
const was = { firstName: chart?.firstName, lastName: chart?.lastName };
if (was.firstName && was.lastName) {
  const before = caught.length;
  const corrected = await call(`/v1/super-admin/patients/${visit.patient.id}/name`, {
    token: owner,
    method: 'POST',
    body: {
      firstName: was.firstName,
      lastName: `${was.lastName}-checked`,
      reason: 'Checking that a correction reaches the client',
    },
    expect: 200,
  });
  ok('a patient’s name can be corrected', corrected.status === 200);

  const same = await call(`/v1/super-admin/patients/${visit.patient.id}/name`, {
    token: owner,
    method: 'POST',
    body: { ...was, lastName: `${was.lastName}-checked`, reason: 'The same name again' },
  });
  ok('correcting it to what it already says is refused', same.status === 400);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const update = caught.slice(before).find((row) => row.event === 'NAME_UPDATE');
  ok('NAME_UPDATE reached the client', Boolean(update), update?.masterId);
  ok(
    'it carries the corrected name',
    update?.lastName === `${was.lastName}-checked`,
    update ? `${update.firstName} ${update.lastName}` : undefined,
  );

  // Put it back: this is somebody's chart, not a fixture.
  await call(`/v1/super-admin/patients/${visit.patient.id}/name`, {
    token: owner,
    method: 'POST',
    body: { ...was, reason: 'Restoring after the integration check' },
  });
  const { payload: after } = await call(`/v1/super-admin/patients/${visit.patient.id}`, {
    token: owner,
  });
  ok('the chart is left as it was found', after?.lastName === was.lastName, after?.lastName);
}

// ── the retired paths still work ────────────────────────────────────────────
const retired = await call(`/partner/v1/visit/externalFetch/${masterId}`, { token: partnerKey });
ok(
  'a retired path still reaches its replacement',
  retired.status === 200 && retired.payload?.masterId === masterId,
  `GET /partner/v1/visit/externalFetch/… → ${retired.status}`,
);

await finish(cleanup);
