import { Injectable, Logger } from '@nestjs/common';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';

export interface PharmacyCredentials {
  username: string;
  password: string;
}

/**
 * Resolves a pharmacy's API credentials from a reference.
 *
 * The database stores a *name*, never a password. That is the whole point of
 * `credentialRef`: a dump of this database, or a Super Admin reading a pharmacy
 * record, reveals which secret to fetch and nothing that can be used.
 *
 * Locally the secret comes from the environment as `PHARMACY_CREDS_<REF>`
 * holding `username:password`, with the reference upper-cased and
 * non-alphanumerics replaced by underscores. In production this is where AWS
 * Secrets Manager goes — the returned shape does not change, so nothing above
 * this class knows the difference.
 */
@Injectable()
export class PharmacyCredentialResolver {
  private readonly logger = new Logger(PharmacyCredentialResolver.name);

  constructor(private readonly phi: PhiCryptoService) {}

  /** Encrypts a pair for storage. The plaintext never touches the database. */
  seal(username: string, password: string): string {
    return this.phi.encrypt(`${username}:${password}`);
  }

  envKeyFor(credentialRef: string): string {
    return `PHARMACY_CREDS_${credentialRef.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  }

  /**
   * The credentials for one pharmacy.
   *
   * Prefers what the console stored against the pharmacy, because each pharmacy
   * has its own LifeFile login and that is where an operator can actually set
   * it. Falls back to the environment so a deployment can keep secrets entirely
   * outside the database if it would rather.
   */
  async resolve(credentialRef: string, cipher?: string | null): Promise<PharmacyCredentials | null> {
    if (cipher) {
      try {
        return this.split(this.phi.decrypt(cipher), 'the stored credential');
      } catch {
        this.logger.error('Stored pharmacy credentials will not decrypt — is PHI_ENCRYPTION_KEY the same one they were saved with?');
        return null;
      }
    }

    const key = this.envKeyFor(credentialRef);
    const raw = process.env[key];

    if (!raw) {
      this.logger.warn(
        `No credentials found for "${credentialRef}". Set ${key}=username:password, ` +
          'or point this at your secret store before enabling the integration.',
      );
      return null;
    }

    return this.split(raw, key);
  }

  private split(raw: string, source: string): PharmacyCredentials | null {
    const separator = raw.indexOf(':');
    if (separator < 1) {
      this.logger.error(`${source} is malformed. Expected "username:password".`);
      return null;
    }
    return { username: raw.slice(0, separator), password: raw.slice(separator + 1) };
  }
}
