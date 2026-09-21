import { randomBytes } from 'node:crypto';
import { PharmacyCredentialResolver } from './credentials';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import type { AppConfig } from '@/shared/config/configuration';

/**
 * Every pharmacy has its own LifeFile login while the order format is shared,
 * so the credential is the one part of the integration that must be per
 * pharmacy — and the one part that must never be readable from the database.
 */
describe('pharmacy credentials', () => {
  const config = { phiEncryptionKey: randomBytes(32).toString('base64') } as AppConfig;
  const resolver = new PharmacyCredentialResolver(new PhiCryptoService(config));

  it('round-trips a pharmacy login without storing it in the clear', async () => {
    const sealed = resolver.seal('firstchoice_api', 's3cret:with:colons');
    expect(sealed).not.toContain('s3cret');
    expect(sealed).not.toContain('firstchoice_api');

    await expect(resolver.resolve('unused', sealed)).resolves.toEqual({
      username: 'firstchoice_api',
      // A password containing colons must survive — only the first one splits.
      password: 's3cret:with:colons',
    });
  });

  it('gives each pharmacy its own credentials', async () => {
    const first = resolver.seal('first_choice', 'one');
    const apex = resolver.seal('apex', 'two');

    await expect(resolver.resolve('x', first)).resolves.toMatchObject({ username: 'first_choice' });
    await expect(resolver.resolve('x', apex)).resolves.toMatchObject({ username: 'apex' });
  });

  it('refuses a cipher it cannot read rather than sending a blank login', async () => {
    await expect(resolver.resolve('x', 'not-a-real-cipher')).resolves.toBeNull();
  });

  it('falls back to the environment when nothing is stored', async () => {
    process.env.PHARMACY_CREDS_ACME_RX = 'env_user:env_pass';
    await expect(resolver.resolve('acme-rx')).resolves.toEqual({
      username: 'env_user',
      password: 'env_pass',
    });
    delete process.env.PHARMACY_CREDS_ACME_RX;
  });

  it('reports nothing rather than guessing when the secret is absent', async () => {
    await expect(resolver.resolve('never-configured')).resolves.toBeNull();
  });
});
