import { clearListCache, cached, loadList } from './list-cache';
import { api } from './api';

const body = (rows: string[]) => ({
  data: rows,
  pageInfo: { page: 1, pageSize: 25, total: rows.length },
  meta: null,
});

function respond(payload: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(payload),
  } as Response);
}

describe('the list cache', () => {
  beforeEach(() => {
    clearListCache();
    jest.restoreAllMocks();
  });

  it('serves a second caller from one request', async () => {
    const fetcher = jest.fn(() => respond(body(['a'])));
    global.fetch = fetcher as unknown as typeof fetch;

    // Two callers, started before either resolves — React's development
    // double-mount, and two components reading the same list.
    const [first, second] = await Promise.all([
      loadList<string>('visits', '/api/bff/visits'),
      loadList<string>('visits', '/api/bff/visits'),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('remembers the answer so a revisit costs nothing', async () => {
    global.fetch = jest.fn(() => respond(body(['a']))) as unknown as typeof fetch;

    await loadList<string>('visits', '/api/bff/visits');
    expect(cached<string>('visits')?.body.data).toEqual(['a']);
  });

  it('keeps separate answers for separate queries', async () => {
    global.fetch = jest.fn(() => respond(body(['a']))) as unknown as typeof fetch;

    await loadList<string>('visits?page=1', '/api/bff/visits?page=1');
    expect(cached('visits?page=2')).toBeUndefined();
  });

  it('does not cache a failure', async () => {
    global.fetch = jest.fn(() =>
      respond({ message: 'nope' }, false, 500),
    ) as unknown as typeof fetch;

    await expect(loadList<string>('visits', '/api/bff/visits')).rejects.toThrow('nope');
    expect(cached('visits')).toBeUndefined();
  });

  it('lets the next caller retry after a failure', async () => {
    const fetcher = jest
      .fn()
      .mockImplementationOnce(() => respond({ message: 'nope' }, false, 500))
      .mockImplementationOnce(() => respond(body(['a'])));
    global.fetch = fetcher as unknown as typeof fetch;

    await expect(loadList<string>('visits', '/api/bff/visits')).rejects.toThrow();
    // The in-flight entry has to be released, or one blip freezes the table
    // until a reload.
    await expect(loadList<string>('visits', '/api/bff/visits')).resolves.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('a write invalidates every cached list', () => {
  beforeEach(() => {
    clearListCache();
    jest.restoreAllMocks();
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('%s empties the cache', async (method) => {
    global.fetch = jest.fn(() => respond(body(['a']))) as unknown as typeof fetch;
    await loadList<string>('visits', '/api/bff/visits');
    expect(cached('visits')).toBeDefined();

    await api('v1/whatever', { method });

    // Coarse on purpose: working out which lists a write could have touched
    // means knowing that shipping an order changes three of them.
    expect(cached('visits')).toBeUndefined();
  });

  it('leaves the cache alone on a read', async () => {
    global.fetch = jest.fn(() => respond(body(['a']))) as unknown as typeof fetch;
    await loadList<string>('visits', '/api/bff/visits');

    await api('v1/whatever');

    expect(cached('visits')).toBeDefined();
  });

  it('leaves the cache alone when the write failed', async () => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(() => respond(body(['a'])))
      .mockImplementationOnce(() => respond({ message: 'denied' }, false, 403));

    await loadList<string>('visits', '/api/bff/visits');
    await expect(api('v1/whatever', { method: 'DELETE' })).rejects.toThrow();

    // Nothing changed, so nothing is stale. Clearing here would throw away a
    // good cache every time somebody hits a permission error.
    expect(cached('visits')).toBeDefined();
  });
});
