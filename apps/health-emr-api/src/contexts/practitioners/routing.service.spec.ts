import { RoutingService } from './routing.service';

/**
 * The routing rule decides who is legally allowed to treat a patient, so every
 * branch gets a test. Structural vs transient matters commercially as well as
 * clinically: structural means reject at intake before the tenant charges the
 * patient; transient means queue and retry.
 */
describe('RoutingService', () => {
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const past = new Date(Date.now() - 24 * 3600 * 1000);

  const makeProvider = (over: Partial<any> = {}) => ({
    id: 'prov-1',
    isAcceptingRequests: true,
    maxOpenRequests: 25,
    licenses: [{ state: 'CA', status: 'ACTIVE', expiresAt: future, licenseNumber: 'CA-123' }],
    categories: [{ categoryId: 'cat-1' }],
    _count: { requests: 0 },
    ...over,
  });

  const build = (opts: {
    policy?: { allowsAsyncPrescribing: boolean } | null;
    roster?: string[];
    providers?: any[];
    sharedLoad?: any[];
  }) => {
    const prisma = {
      raw: {
        // `opts.policy ?? default` would swallow an explicit `null`, which is
        // exactly the missing-policy case under test — so branch on presence.
        statePolicy: {
          findUnique: jest
            .fn()
            .mockResolvedValue('policy' in opts ? opts.policy : { allowsAsyncPrescribing: true }),
        },
        providerProfile: { findMany: jest.fn().mockResolvedValue(opts.providers ?? []) },
        // Lines a clinician owns on visits led by somebody else. Empty unless a
        // test is specifically about shared load.
        prescriptionRequestItem: {
          groupBy: jest.fn().mockResolvedValue(opts.sharedLoad ?? []),
        },
        routingAttempt: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
    };
    const entitlements = {
      rosterProviderIds: jest.fn().mockResolvedValue(opts.roster ?? ['prov-1']),
    };
    return {
      service: new RoutingService(prisma as any, entitlements as any),
      prisma,
      entitlements,
    };
  };

  const params = { tenantId: 'ten-1', categoryId: 'cat-1', patientState: 'CA' };

  it('assigns a licensed, qualified, available provider', async () => {
    const { service } = build({ providers: [makeProvider()] });
    const decision = await service.route(params);

    expect(decision.assignedProviderId).toBe('prov-1');
    expect(decision.failure).toBe('none');
    expect(decision.attempts.at(-1)).toMatchObject({ providerId: 'prov-1', outcome: 'ASSIGNED' });
  });

  it('refuses structurally when the state has no policy on record', async () => {
    const { service } = build({ policy: null, providers: [makeProvider()] });
    const decision = await service.route(params);

    expect(decision.assignedProviderId).toBeNull();
    expect(decision.failure).toBe('structural');
    expect(decision.reason).toMatch(/No prescribing policy/);
  });

  it('refuses structurally when the state forbids async prescribing', async () => {
    const { service } = build({
      policy: { allowsAsyncPrescribing: false },
      providers: [makeProvider()],
    });
    const decision = await service.route({ ...params, patientState: 'AR' });

    expect(decision.failure).toBe('structural');
    expect(decision.reason).toMatch(/does not permit asynchronous prescribing/);
  });

  it('does not consider a provider who is not on the tenant roster', async () => {
    const { service, prisma } = build({ roster: [], providers: [makeProvider()] });
    const decision = await service.route(params);

    expect(decision.failure).toBe('structural');
    expect(prisma.raw.providerProfile.findMany).not.toHaveBeenCalled();
  });

  it('treats a missing licence as structural', async () => {
    const { service } = build({ providers: [makeProvider({ licenses: [] })] });
    const decision = await service.route(params);

    expect(decision.failure).toBe('structural');
    expect(decision.attempts).toContainEqual({ providerId: 'prov-1', outcome: 'NO_LICENSE' });
  });

  it('drops a provider whose licence has expired, without anyone flipping a flag', async () => {
    const { service } = build({
      providers: [
        makeProvider({
          licenses: [{ state: 'CA', status: 'ACTIVE', expiresAt: past, licenseNumber: 'CA-123' }],
        }),
      ],
    });
    const decision = await service.route(params);

    expect(decision.assignedProviderId).toBeNull();
    expect(decision.attempts[0].outcome).toBe('LICENSE_EXPIRED');
  });

  it('drops a suspended licence', async () => {
    const { service } = build({
      providers: [
        makeProvider({
          licenses: [{ state: 'CA', status: 'SUSPENDED', expiresAt: future, licenseNumber: 'CA-123' }],
        }),
      ],
    });
    const decision = await service.route(params);
    expect(decision.attempts[0].outcome).toBe('LICENSE_EXPIRED');
  });

  it('treats an unqualified provider as structural', async () => {
    const { service } = build({ providers: [makeProvider({ categories: [] })] });
    const decision = await service.route(params);

    expect(decision.failure).toBe('structural');
    expect(decision.attempts[0].outcome).toBe('NOT_QUALIFIED');
  });

  it('treats capacity as transient, so the visit queues rather than being refused', async () => {
    const { service } = build({
      providers: [makeProvider({ maxOpenRequests: 2, _count: { requests: 2 } })],
    });
    const decision = await service.route(params);

    expect(decision.assignedProviderId).toBeNull();
    expect(decision.failure).toBe('transient');
    expect(decision.attempts[0]).toMatchObject({ outcome: 'AT_CAPACITY', detail: '2/2 open' });
  });

  it('treats a provider who paused intake as transient', async () => {
    const { service } = build({ providers: [makeProvider({ isAcceptingRequests: false })] });
    const decision = await service.route(params);

    expect(decision.failure).toBe('transient');
    expect(decision.attempts[0].outcome).toBe('NOT_ACCEPTING');
  });

  it('balances load by picking the least busy eligible provider', async () => {
    const { service } = build({
      roster: ['prov-1', 'prov-2', 'prov-3'],
      providers: [
        makeProvider({ id: 'prov-1', _count: { requests: 7 } }),
        makeProvider({ id: 'prov-2', _count: { requests: 2 } }),
        makeProvider({ id: 'prov-3', _count: { requests: 9 } }),
      ],
    });
    const decision = await service.route(params);
    expect(decision.assignedProviderId).toBe('prov-2');
  });

  it('breaks ties deterministically so a route can be replayed', async () => {
    const { service } = build({
      roster: ['prov-b', 'prov-a'],
      providers: [
        makeProvider({ id: 'prov-b', _count: { requests: 3 } }),
        makeProvider({ id: 'prov-a', _count: { requests: 3 } }),
      ],
    });
    const first = await service.route(params);
    const second = await service.route(params);

    expect(first.assignedProviderId).toBe('prov-a');
    expect(second.assignedProviderId).toBe('prov-a');
  });

  it('records why each rejected provider was skipped', async () => {
    const { service, prisma } = build({
      roster: ['prov-1', 'prov-2'],
      providers: [
        makeProvider({ id: 'prov-1', licenses: [] }),
        makeProvider({ id: 'prov-2' }),
      ],
    });
    const decision = await service.route(params);
    await service.recordAttempts('req-1', decision.attempts);

    expect(prisma.raw.routingAttempt.createMany).toHaveBeenCalledWith({
      data: [
        { requestId: 'req-1', providerId: 'prov-1', rule: 'eligibility', outcome: 'NO_LICENSE', detail: null },
        expect.objectContaining({ providerId: 'prov-2', outcome: 'ASSIGNED' }),
      ],
    });
  });
});

/**
 * A visit can carry medications from different clinical categories. One
 * clinician for the whole visit is always preferred; sharing it out is the
 * fallback, and it changes who gets paid, so both paths are pinned here.
 */
describe('RoutingService.routeVisit — a visit spanning categories', () => {
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const provider = (id: string, categoryIds: string[], load = 0) => ({
    id,
    isAcceptingRequests: true,
    maxOpenRequests: 25,
    licenses: [{ state: 'CA', status: 'ACTIVE', expiresAt: future, licenseNumber: `CA-${id}` }],
    categories: categoryIds.map((categoryId) => ({ categoryId })),
    _count: { requests: load },
  });

  const build = (providers: any[]) => {
    const prisma = {
      raw: {
        statePolicy: { findUnique: jest.fn().mockResolvedValue({ allowsAsyncPrescribing: true }) },
        providerProfile: { findMany: jest.fn().mockResolvedValue(providers) },
        prescriptionRequestItem: { groupBy: jest.fn().mockResolvedValue([]) },
        routingAttempt: { createMany: jest.fn() },
      },
    };
    const entitlements = {
      rosterProviderIds: jest.fn().mockResolvedValue(providers.map((row) => row.id)),
    };
    return { service: new RoutingService(prisma as any, entitlements as any), prisma };
  };

  const visit = (providers: any[]) => {
    const { service, prisma } = build(providers);
    return {
      prisma,
      decision: service.routeVisit({
        tenantId: 'ten-1',
        patientState: 'CA',
        fallbackCategoryId: 'cat-weightloss',
        lines: [
          { key: 'line-wl', label: 'Semaglutide', categoryIds: ['cat-weightloss'] },
          { key: 'line-ed', label: 'Sildenafil', categoryIds: ['cat-ed'] },
        ],
      }),
    };
  };

  it('keeps the visit whole when one clinician covers every category', async () => {
    const { decision } = visit([
      provider('prov-both', ['cat-weightloss', 'cat-ed']),
      provider('prov-wl', ['cat-weightloss']),
    ]);
    const result = await decision;

    expect(result.split).toBe(false);
    expect(result.assignedProviderId).toBe('prov-both');
    expect(result.lines.map((line) => line.providerId)).toEqual(['prov-both', 'prov-both']);
  });

  it('prefers one clinician even when a specialist is less busy', async () => {
    // The generalist is carrying more work, and still wins: one review beats
    // two, for the patient and for the fee.
    const { decision } = visit([
      provider('prov-both', ['cat-weightloss', 'cat-ed'], 10),
      provider('prov-wl', ['cat-weightloss'], 0),
      provider('prov-ed', ['cat-ed'], 0),
    ]);

    await expect(decision).resolves.toMatchObject({ split: false, assignedProviderId: 'prov-both' });
  });

  it('shares the visit out when nobody covers both', async () => {
    const { decision } = visit([
      provider('prov-wl', ['cat-weightloss']),
      provider('prov-ed', ['cat-ed']),
    ]);
    const result = await decision;

    expect(result.split).toBe(true);
    expect(result.failure).toBe('none');
    expect(result.lines).toEqual([
      { key: 'line-wl', providerId: 'prov-wl' },
      { key: 'line-ed', providerId: 'prov-ed' },
    ]);
    // Somebody has to be named on the chart; ties break on id, deterministically.
    expect(result.assignedProviderId).toBe('prov-ed');
  });

  it('refuses the whole visit rather than placing part of it', async () => {
    // Placing the weight-loss line and stranding the ED one would leave a
    // patient who has already paid waiting on a review nobody can do.
    const { decision } = visit([provider('prov-wl', ['cat-weightloss'])]);
    const result = await decision;

    expect(result.lines).toEqual([]);
    expect(result.failure).toBe('structural');
    expect(result.reason).toContain('Sildenafil');
  });

  it('falls back to the visit category for a medication nobody filed', async () => {
    const { service } = build([provider('prov-wl', ['cat-weightloss'])]);

    const result = await service.routeVisit({
      tenantId: 'ten-1',
      patientState: 'CA',
      fallbackCategoryId: 'cat-weightloss',
      lines: [{ key: 'line-1', label: 'Unfiled product', categoryIds: [] }],
    });

    expect(result.assignedProviderId).toBe('prov-wl');
    expect(result.split).toBe(false);
  });

  it('does not repeat the same verdict once per line in the trail', async () => {
    const { decision } = visit([
      provider('prov-wl', ['cat-weightloss']),
      provider('prov-ed', ['cat-ed']),
      { ...provider('prov-none', ['cat-hair']), licenses: [] },
    ]);
    const result = await decision;

    const unlicensed = result.attempts.filter((row) => row.outcome === 'NO_LICENSE');
    expect(unlicensed).toEqual([{ providerId: 'prov-none', outcome: 'NO_LICENSE' }]);
  });
});

describe('RoutingService — runner-up trail', () => {
  it('records eligible providers that were not chosen', async () => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const provider = (id: string, load: number) => ({
      id,
      isAcceptingRequests: true,
      maxOpenRequests: 25,
      licenses: [{ state: 'CA', status: 'ACTIVE', expiresAt: future, licenseNumber: 'CA-1' }],
      categories: [{ categoryId: 'cat-1' }],
      _count: { requests: load },
    });

    const prisma = {
      raw: {
        statePolicy: { findUnique: jest.fn().mockResolvedValue({ allowsAsyncPrescribing: true }) },
        providerProfile: {
          findMany: jest.fn().mockResolvedValue([provider('prov-a', 5), provider('prov-b', 1)]),
        },
        prescriptionRequestItem: { groupBy: jest.fn().mockResolvedValue([]) },
        routingAttempt: { createMany: jest.fn() },
      },
    };
    const entitlements = { rosterProviderIds: jest.fn().mockResolvedValue(['prov-a', 'prov-b']) };
    const service = new RoutingService(prisma as any, entitlements as any);

    const decision = await service.route({
      tenantId: 'ten-1',
      categoryId: 'cat-1',
      patientState: 'CA',
    });

    expect(decision.assignedProviderId).toBe('prov-b');
    expect(decision.attempts).toContainEqual({
      providerId: 'prov-a',
      outcome: 'NOT_SELECTED',
      detail: 'eligible with 5 open requests',
    });
  });
});
