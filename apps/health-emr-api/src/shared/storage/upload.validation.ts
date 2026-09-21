import { BadRequestException } from '@nestjs/common';

/**
 * What we accept as a legal document.
 *
 * Allowlisted by both extension and magic bytes, because a browser-supplied
 * Content-Type is a claim, not evidence. Uploading a licence is a route that a
 * stranger can reach, so a file that says "application/pdf" and starts with
 * `<?php` should never reach disk.
 */
const ALLOWED: Record<string, { mime: string; magic: Buffer[] }> = {
  pdf: { mime: 'application/pdf', magic: [Buffer.from('%PDF')] },
  png: { mime: 'image/png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47])] },
  jpg: { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  jpeg: { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function validateUpload(file: {
  originalname: string;
  buffer: Buffer;
  size: number;
}): { mime: string } {
  if (!file?.buffer?.length) throw new BadRequestException('The file is empty');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(`Files must be under ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
  }

  const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  const allowed = ALLOWED[extension];
  if (!allowed) {
    throw new BadRequestException(
      `Unsupported file type ".${extension}". Upload a PDF, PNG or JPEG.`,
    );
  }

  const matches = allowed.magic.some((signature) =>
    file.buffer.subarray(0, signature.length).equals(signature),
  );
  if (!matches) {
    throw new BadRequestException(
      `That file is not a valid ${extension.toUpperCase()} — its contents do not match its extension.`,
    );
  }

  return { mime: allowed.mime };
}
