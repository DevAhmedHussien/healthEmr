import { HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * How many wrong passwords one account gets before it waits.
 *
 * The counting rule matters as much as the number. Per address would lock out
 * the eleventh clinician after a shift change, because a clinic sits behind one
 * address — which forces the limit up until it protects nothing.
 */
describe('sign-in rate limiting', () => {
  const build = (recentFailures: number) => {
    const count = jest.fn().mockResolvedValue(recentFailures);
    const findUnique = jest.fn().mockResolvedValue(null);
    const record = jest.fn().mockResolvedValue(undefined);

    // Constructor order: prisma, tokens, audit.
    const service = new AuthService(
      { raw: { auditLog: { count }, user: { findUnique } } } as never,
      { newSessionId: jest.fn(), issue: jest.fn() } as never,
      { record } as never,
    );

    return { service, count, findUnique, record };
  };

  it('lets a normal run of typos through', async () => {
    const { service, findUnique } = build(3);

    // Rejected for the password, not for the rate — the user reaches the check.
    await expect(service.login('nurse@clinic.test', 'wrong')).rejects.toMatchObject({
      status: 401,
    });
    expect(findUnique).toHaveBeenCalled();
  });

  it('refuses once an account is being worked through', async () => {
    const { service, findUnique } = build(10);

    const failure = await service.login('nurse@clinic.test', 'wrong').catch((error) => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    // Refused before the password is even looked up: the point is to stop
    // doing the expensive verification for an attacker.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('counts the account, not the address', async () => {
    const { service, count } = build(0);
    await service.login('Nurse@Clinic.TEST ', 'wrong').catch(() => undefined);

    const where = count.mock.calls[0][0].where;
    expect(where.action).toBe('LOGIN_FAILED');
    // Normalised, so `Nurse@…` and `nurse@…` share one budget rather than
    // giving an attacker a fresh ten per spelling.
    expect(JSON.stringify(where.OR)).toContain('nurse@clinic.test');
    expect(JSON.stringify(where)).not.toContain('ip');
  });

  it('records being refused, so a run of attempts is visible afterwards', async () => {
    const { service, record } = build(10);
    await service.login('nurse@clinic.test', 'wrong').catch(() => undefined);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOGIN_FAILED',
        after: expect.objectContaining({ reason: 'rate_limited' }),
      }),
    );
  });
});
