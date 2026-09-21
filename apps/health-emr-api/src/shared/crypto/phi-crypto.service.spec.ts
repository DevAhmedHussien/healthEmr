import { randomBytes } from 'node:crypto';
import { PhiCryptoService } from './phi-crypto.service';
import type { AppConfig } from '../config/configuration';

const configWith = (key: string): AppConfig =>
  ({ phiEncryptionKey: key } as AppConfig);

describe('PhiCryptoService', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a value', () => {
    const service = new PhiCryptoService(configWith(key));
    const secret = '03/14/1984';
    expect(service.decrypt(service.encrypt(secret))).toBe(secret);
  });

  it('produces different ciphertext for the same input', () => {
    const service = new PhiCryptoService(configWith(key));
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('rejects tampered ciphertext instead of returning garbage', () => {
    const service = new PhiCryptoService(configWith(key));
    const ciphertext = service.encrypt('sensitive');
    const [prefixed, tag] = ciphertext.split('.');
    const tampered = `${prefixed}.${tag}.${Buffer.from('evil').toString('base64')}`;
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('leaves never-encrypted values alone, so migration can be incremental', () => {
    const service = new PhiCryptoService(configWith(key));
    expect(service.decrypt('plain legacy value')).toBe('plain legacy value');
  });

  it('round-trips JSON', () => {
    const service = new PhiCryptoService(configWith(key));
    const value = { allergies: ['penicillin'], weightLbs: 210 };
    expect(service.decryptJson(service.encryptJson(value))).toEqual(value);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new PhiCryptoService(configWith(randomBytes(16).toString('base64')))).toThrow(
      /32 bytes/,
    );
  });

  it('passes through unchanged when no key is configured', () => {
    const service = new PhiCryptoService(configWith(''));
    expect(service.enabled).toBe(false);
    expect(service.encrypt('plain')).toBe('plain');
  });
});
