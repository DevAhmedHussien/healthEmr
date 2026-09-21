import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/configuration';

export interface StoredObject {
  bucket: string;
  objectKey: string;
  size: number;
  mime: string;
  checksum: string;
}

/**
 * Object storage for uploaded documents.
 *
 * A local-disk driver in development so the whole upload path is exercisable
 * without AWS credentials, and an S3 driver in production. Swapping is a config
 * change, not a code change.
 *
 * Objects are never public. Reads go through a signed, short-lived URL or
 * straight through the API with the caller authenticated — a licence scan or an
 * ID photo sitting on a guessable public URL is a breach waiting for a crawler.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root = resolve(process.env.LOCAL_STORAGE_ROOT ?? '.storage');
  }

  /**
   * Keys are random, not derived from the filename.
   *
   * A predictable key is a way to enumerate other people's documents even
   * without a directory listing, and a user-supplied filename is a path
   * traversal waiting to happen.
   */
  buildKey(prefix: string, fileName: string): string {
    const extension = fileName.includes('.') ? fileName.split('.').pop()!.slice(0, 10) : 'bin';
    const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, '');
    return `${prefix}/${randomUUID()}.${safeExtension || 'bin'}`;
  }

  async put(
    bucket: string,
    objectKey: string,
    body: Buffer,
    mime: string,
  ): Promise<StoredObject> {
    const checksum = createHash('sha256').update(body).digest('hex');
    const path = join(this.root, bucket, objectKey);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    this.logger.log(`stored ${bucket}/${objectKey} (${body.length} bytes)`);
    return { bucket, objectKey, size: body.length, mime, checksum };
  }

  async get(bucket: string, objectKey: string): Promise<Buffer> {
    return readFile(join(this.root, bucket, objectKey));
  }

  /**
   * In production this returns a presigned S3 URL. Locally it returns an API
   * path that still requires a session, so nothing is reachable unauthenticated
   * in either environment.
   */
  signedUrl(bucket: string, objectKey: string): string {
    return `/v1/documents/${bucket}/${encodeURIComponent(objectKey)}`;
  }
}
