import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { ObjectStorageService } from '@/shared/storage/object-storage.service';
import { AuditService } from '@/shared/audit/audit.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

/** 8MB per image, decoded. A phone photo is 2–5MB; beyond this is a scan. */
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);

export interface InboundImage {
  mime: string;
  /** Base64, with or without a data-URL prefix. */
  data: string;
}

/**
 * The photos attached to a visit.
 *
 * A separate call after the visit exists, matching the contract a client is
 * already integrated against: the intake returns a `visitId`, and the images
 * are posted against it. Keeping them off the intake payload is also the right
 * shape on its own — a 6MB base64 blob inside the request that creates a patient
 * makes a retry expensive and a timeout likely.
 *
 * What arrives is a government ID and, sometimes, a photo of a prescription
 * label. Both are PHI: they are written to object storage and recorded against
 * the patient, never logged, and never returned by a partner endpoint.
 */
@Injectable()
export class VisitPhotosService {
  private readonly logger = new Logger(VisitPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The photos on a visit.
   *
   * Metadata by default and the bytes only when asked for, because a visit
   * lookup that always carries several megabytes of base64 is one a client
   * stops polling. `include` makes the expensive answer a deliberate request
   * rather than the default.
   */
  async list(
    tenantId: string,
    visitId: string,
    options: { includeData?: boolean } = {},
  ): Promise<
    Array<{
      id: string;
      kind: string;
      mime: string;
      size: number;
      uploadedAt: string;
      data?: string;
    }>
  > {
    return runWithoutTenantScope(async () => {
      const visit = await this.prisma.raw.prescriptionRequest.findFirst({
        where: { id: visitId, tenantId },
        select: { patientId: true, createdAt: true },
      });
      if (!visit) throw new NotFoundException('Visit not found');

      const documents = await this.prisma.raw.patientDocument.findMany({
        where: {
          patientId: visit.patientId,
          kind: { in: ['ID_PHOTO', 'RX_PHOTO'] },
          // Photos belong to the visit they were uploaded for. A patient with
          // two visits should not see the second one carrying the first one's
          // identification.
          objectKey: { contains: `/visits/${visitId}/` },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          mime: true,
          size: true,
          bucket: true,
          objectKey: true,
          createdAt: true,
        },
      });

      return Promise.all(
        documents.map(async (document) => ({
          id: document.id,
          kind: document.kind,
          mime: document.mime,
          size: document.size,
          uploadedAt: document.createdAt.toISOString(),
          ...(options.includeData
            ? {
                data: (await this.storage.get(document.bucket, document.objectKey)).toString(
                  'base64',
                ),
              }
            : {}),
        })),
      );
    });
  }

  /** One photo's bytes, for rendering it. */
  async read(tenantId: string, documentId: string): Promise<{ mime: string; body: Buffer }> {
    return runWithoutTenantScope(async () => {
      const document = await this.prisma.raw.patientDocument.findFirst({
        where: {
          id: documentId,
          kind: { in: ['ID_PHOTO', 'RX_PHOTO'] },
          patient: { tenantLinks: { some: { tenantId } } },
        },
        select: { bucket: true, objectKey: true, mime: true },
      });
      if (!document) throw new NotFoundException('Photo not found');

      return {
        mime: document.mime,
        body: await this.storage.get(document.bucket, document.objectKey),
      };
    });
  }

  async attach(
    tenantId: string,
    visitId: string,
    images: InboundImage[],
    kind: 'ID_PHOTO' | 'RX_PHOTO' = 'ID_PHOTO',
  ): Promise<{ stored: number; rejected: Array<{ index: number; why: string }> }> {
    return runWithoutTenantScope(async () => {
      const visit = await this.prisma.raw.prescriptionRequest.findFirst({
        where: { id: visitId, tenantId },
        select: { id: true, patientId: true },
      });

      // Scoped to the calling tenant, so another client's visit is not found
      // rather than forbidden — the difference tells them it exists.
      if (!visit) throw new NotFoundException('Visit not found');

      const rejected: Array<{ index: number; why: string }> = [];
      let stored = 0;

      for (const [index, image] of images.entries()) {
        const mime = (image.mime || '').toLowerCase().trim();
        if (!ALLOWED.has(mime)) {
          rejected.push({ index, why: `${mime || 'unknown type'} is not an accepted image type` });
          continue;
        }

        const base64 = image.data.includes('base64,')
          ? (image.data.split('base64,').pop() ?? '')
          : image.data;
        const body = Buffer.from(base64.trim(), 'base64');

        if (!body.length) {
          rejected.push({ index, why: 'could not be decoded' });
          continue;
        }
        if (body.length > MAX_BYTES) {
          rejected.push({
            index,
            why: `is ${Math.round(body.length / 1024 / 1024)}MB; the limit is 8MB`,
          });
          continue;
        }

        const objectKey = this.storage.buildKey(
          `patients/${visit.patientId}/visits/${visit.id}`,
          `photo.${mime.split('/')[1] ?? 'jpg'}`,
        );
        const object = await this.storage.put('patient-documents', objectKey, body, mime);

        await this.prisma.raw.patientDocument.create({
          data: {
            patientId: visit.patientId,
            kind,
            bucket: object.bucket,
            objectKey: object.objectKey,
            mime,
            size: object.size,
            fileName: `${kind === 'ID_PHOTO' ? 'identification' : 'prescription'}.${mime.split('/')[1] ?? 'jpg'}`,
          },
        });
        stored += 1;
      }

      await this.audit.record({
        action: 'PHI_CREATED',
        entityType: 'PatientDocument',
        entityId: visit.id,
        patientId: visit.patientId,
        tenantId,
        after: { visitId: visit.id, kind, stored, rejected: rejected.length },
      });

      // Counts only. The filename and the bytes are PHI and do not belong in a
      // log line that ships to a third party.
      this.logger.log(
        `Visit ${visit.id}: stored ${stored} ${kind} image(s), rejected ${rejected.length}`,
      );

      if (!stored && rejected.length) {
        throw new BadRequestException(
          `No images could be stored — ${rejected.map((entry) => `image ${entry.index + 1} ${entry.why}`).join('; ')}`,
        );
      }

      return { stored, rejected };
    });
  }
}
