import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/configuration';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'phi.v1:';

/**
 * Field-level encryption for PHI, layered above whatever the database does at
 * rest. AES-256-GCM so a tampered ciphertext fails to decrypt rather than
 * silently returning garbage.
 *
 * Ciphertext format:  phi.v1:<iv-b64>.<tag-b64>.<payload-b64>
 * The version prefix means a future key rotation can decrypt old rows while
 * writing new ones in a newer scheme.
 */
@Injectable()
export class PhiCryptoService {
  private readonly logger = new Logger(PhiCryptoService.name);
  private readonly key: Buffer | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!config.phiEncryptionKey) {
      this.key = null;
      this.logger.warn(
        'PHI_ENCRYPTION_KEY is not set — PHI fields will be stored in plaintext. Never do this outside local development.',
      );
      return;
    }

    const key = Buffer.from(config.phiEncryptionKey, 'base64');
    if (key.length !== 32) {
      throw new Error(
        `PHI_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}`,
      );
    }
    this.key = key;
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const payload = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${payload.toString('base64')}`;
  }

  /** Returns the input unchanged if it was never encrypted, so migration is incremental. */
  decrypt(value: string): string {
    if (!this.key || !value.startsWith(PREFIX)) return value;

    const [ivPart, tagPart, payloadPart] = value.slice(PREFIX.length).split('.');
    if (!ivPart || !tagPart || !payloadPart) {
      throw new Error('Malformed PHI ciphertext');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(payloadPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(value: string): T {
    return JSON.parse(this.decrypt(value)) as T;
  }
}
