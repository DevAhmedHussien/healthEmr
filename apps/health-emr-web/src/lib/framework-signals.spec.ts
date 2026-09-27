import { isFrameworkSignal, swallow } from './framework-signals';

/**
 * A fallback handler must not eat the framework's own control flow.
 *
 * `redirect()` and `notFound()` are thrown, so `.catch(() => null)` catches
 * them like any other failure — and the page carries on rendering as though
 * the record were simply missing. For an expired session that turns "sign in
 * again" into "not found", which sends somebody looking for a record that was
 * there all along.
 */

/** Shaped as Next throws them. */
const redirectError = (to = '/login') =>
  Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
const notFoundError = () => Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });

describe('isFrameworkSignal', () => {
  it('recognises a redirect', () => {
    expect(isFrameworkSignal(redirectError())).toBe(true);
  });

  it('recognises a not-found', () => {
    expect(isFrameworkSignal(notFoundError())).toBe(true);
  });

  it.each([
    ['an ordinary error', new Error('Request failed (500)')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['an object with a numeric digest', { digest: 404 }],
    ['an object with an unrelated digest', { digest: 'SOMETHING_ELSE' }],
  ])('does not mistake %s for one', (_label, value) => {
    expect(isFrameworkSignal(value)).toBe(false);
  });
});

describe('swallow', () => {
  it('returns the fallback for a real failure', () => {
    expect(swallow(null)(new Error('Request failed (500)'))).toBeNull();
    expect(swallow([])(new Error('nope'))).toEqual([]);
  });

  it('rethrows a redirect rather than turning it into a fallback', () => {
    expect(() => swallow(null)(redirectError('/login?next=%2Fclinic'))).toThrow('NEXT_REDIRECT');
  });

  it('rethrows a not-found', () => {
    expect(() => swallow(null)(notFoundError())).toThrow('NEXT_NOT_FOUND');
  });

  it('preserves the thrown value exactly, so Next can still read its digest', () => {
    const thrown = redirectError('/login');
    try {
      swallow(null)(thrown);
      throw new Error('should have rethrown');
    } catch (caught) {
      expect(caught).toBe(thrown);
    }
  });

  /** The behaviour every existing `.catch(() => null)` call site relied on. */
  it('still works as a plain fallback in a promise chain', async () => {
    await expect(Promise.reject(new Error('down')).catch(swallow(null))).resolves.toBeNull();
    await expect(Promise.reject(redirectError()).catch(swallow(null))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });
});
