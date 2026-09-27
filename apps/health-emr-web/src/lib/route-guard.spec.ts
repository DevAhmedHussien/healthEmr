import { Role } from '@health-emr/types';
import { SESSION_EXPIRED, decideRoute, loginWithReturn } from './route-guard';

/**
 * Where a request goes, decided from the session alone.
 *
 * The case this file exists for is the third block: a session cookie that
 * still decrypts and still carries a role, whose access token can no longer be
 * refreshed. It used to be waved through as though signed in, and the page
 * behind it answered 401 — so being logged out looked like the application
 * breaking.
 */

const at = (pathname: string, over: { role?: Role; error?: string } = {}) =>
  decideRoute({ pathname, ...over });

describe('no session at all', () => {
  it.each(['/portal', '/clinic', '/dispensary', '/admin', '/super-admin'])(
    'sends %s to login, carrying where to come back to',
    (path) => {
      expect(at(path)).toEqual({ type: 'redirect', to: `/login?next=${encodeURIComponent(path)}` });
    },
  );

  it('keeps the deep path, not just the section', () => {
    expect(at('/super-admin/visits/abc-123')).toEqual({
      type: 'redirect',
      to: '/login?next=%2Fsuper-admin%2Fvisits%2Fabc-123',
    });
  });

  it('leaves the login page alone', () => {
    expect(at('/login')).toEqual({ type: 'allow' });
  });
});

describe('a live session', () => {
  it('lets a role into its own area', () => {
    expect(at('/clinic', { role: Role.PROVIDER })).toEqual({ type: 'allow' });
    expect(at('/portal/visits', { role: Role.PATIENT })).toEqual({ type: 'allow' });
  });

  it('sends a role that does not belong to its own home instead', () => {
    expect(at('/clinic', { role: Role.PATIENT })).toEqual({ type: 'redirect', to: '/portal' });
    expect(at('/super-admin', { role: Role.ADMIN })).toEqual({ type: 'redirect', to: '/admin' });
  });

  it('accepts an owner wherever a super admin belongs', () => {
    expect(at('/super-admin/team', { role: Role.OWNER })).toEqual({ type: 'allow' });
  });

  it('sends somebody already signed in away from the login page', () => {
    expect(at('/login', { role: Role.PROVIDER })).toEqual({ type: 'redirect', to: '/clinic' });
  });
});

describe('a session whose refresh failed', () => {
  const dead = { role: Role.PROVIDER, error: SESSION_EXPIRED };

  it('is treated as signed out, however complete the cookie looks', () => {
    expect(at('/clinic', dead)).toEqual({ type: 'redirect', to: '/login?next=%2Fclinic' });
  });

  it.each([
    ['/portal', Role.PATIENT],
    ['/admin', Role.ADMIN],
    ['/super-admin', Role.OWNER],
    ['/dispensary', Role.PHARMACY],
  ])('is refused %s even holding the right role', (path, role) => {
    expect(at(path, { role, error: SESSION_EXPIRED })).toMatchObject({ type: 'redirect' });
    expect(at(path, { role, error: SESSION_EXPIRED })).toMatchObject({
      to: expect.stringContaining('/login'),
    });
  });

  /**
   * The trap. Keyed on the role alone, an expired session is sent from /login
   * to its home page, and from there straight back to /login — a loop that
   * ends only when somebody clears the cookie by hand.
   */
  it('can still reach the login page, rather than bouncing between the two', () => {
    expect(at('/login', dead)).toEqual({ type: 'allow' });
  });

  it('does not treat some other error as the end of the session', () => {
    // Only a failed refresh means the session is over. Anything else the token
    // happens to be carrying is not this decision to make.
    expect(at('/clinic', { role: Role.PROVIDER, error: 'SomethingElse' })).toEqual({
      type: 'allow',
    });
  });
});

describe('loginWithReturn', () => {
  it('encodes the path so a query string survives the round trip', () => {
    expect(loginWithReturn('/super-admin/visits?stage=SHIPPED')).toBe(
      '/login?next=%2Fsuper-admin%2Fvisits%3Fstage%3DSHIPPED',
    );
  });

  /**
   * `next` is read back as a destination after signing in. A full URL there is
   * an open redirect — a link that looks like ours and lands somewhere else,
   * which is the shape every credential-phishing attempt wants.
   */
  it.each(['//evil.example.com', 'https://evil.example.com', 'javascript:alert(1)'])(
    'refuses to carry %s off-site',
    (hostile) => {
      expect(loginWithReturn(hostile)).toBe('/login?next=%2F');
    },
  );
});
