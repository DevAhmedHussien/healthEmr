import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';
import { MessagingService } from '@/contexts/messaging/messaging.service';

/** What a client may send on the patient's behalf. */
export interface PartnerChatInput {
  content?: string;
  image?: {
    /** Somewhere we can fetch it from. */
    url?: string;
    /** Or the bytes themselves, base64, with or without a data URI prefix. */
    content?: string;
    fileName?: string;
    mime?: string;
  };
}

/** Anything larger than this is not a photograph of a rash. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic']);

/**
 * A patient writing from the client's own portal.
 *
 * The patient never sees this platform: they are on their telehealth brand's
 * site, where they bought the thing. So when a clinician asks them for a
 * clearer photograph, the reply is typed somewhere we have no access to — and
 * until now there was no way for it to reach the clinician waiting for it. The
 * visit simply sat there.
 *
 * This is the other half of DOCTOR_CHAT. The clinician's message goes out by
 * webhook and appears in the client's portal; the patient's reply comes back
 * here and lands in the same conversation, with the clinician seeing it live.
 *
 * It is posted *as the patient*, not as the client. A client business is not a
 * participant in a clinical conversation and must not appear in the transcript
 * as one — a message attributed to "Tila Health" where a patient's own words
 * should be is a record that misleads whoever reads it back.
 */
@Injectable()
export class PartnerChatService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  async receive(tenantId: string, masterId: string, input: PartnerChatInput) {
    if (!input.content?.trim() && !input.image) {
      throw new BadRequestException('Send a message, an image, or both');
    }

    const visit = await this.visitFor(tenantId, masterId);
    const patient = await this.patientUser(visit.patientId);
    const clinicianUserId = await this.clinicianFor(visit);

    const threadId = await this.messaging.openPatientThread({
      tenantId,
      patientId: visit.patientId,
      patientUserId: patient.id,
      providerUserId: clinicianUserId,
    });

    const sent: { messageId?: string; attachmentId?: string } = {};

    if (input.content?.trim()) {
      const message = await this.messaging.send(patient, threadId, {
        content: input.content.trim(),
      });
      sent.messageId = message.id;
    }

    if (input.image) {
      const file = await this.readImage(input.image);
      const attached = await this.messaging.attach(
        patient,
        threadId,
        file,
        // Only when it is the whole message. A caption repeated under a message
        // the patient already sent reads as them saying it twice.
        input.content?.trim() ? undefined : input.content?.trim(),
      );
      sent.attachmentId = attached.attachmentId;
      sent.messageId ??= attached.id;
    }

    return { status: 'MESSAGE_RECEIVED', threadId, ...sent };
  }

  /** The visit, by the client's own identifier, within their own account. */
  private async visitFor(tenantId: string, masterId: string) {
    const visit = await runWithoutTenantScope(() =>
      this.prisma.raw.prescriptionRequest.findFirst({
        // Scoped to the caller's tenant as well as the id: master ids are the
        // client's own and two clients could pick the same string.
        where: { externalMasterId: masterId, tenantId },
        select: {
          id: true,
          patientId: true,
          assignedProviderId: true,
          items: {
            where: { assignedProviderId: { not: null } },
            select: { assignedProviderId: true },
            take: 1,
          },
        },
      }),
    );
    if (!visit) throw new NotFoundException('No visit with that masterId');
    return visit;
  }

  /**
   * The patient's own account.
   *
   * Built as the shape the messaging service expects of a signed-in person,
   * because that is precisely who is speaking — the fact that the words arrived
   * over an API rather than through a browser does not change whose they are.
   */
  private async patientUser(patientId: string): Promise<AuthenticatedUser> {
    const patient = await runWithoutTenantScope(() =>
      this.prisma.raw.patient.findUnique({
        where: { id: patientId },
        select: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } },
        },
      }),
    );

    if (!patient?.user) {
      throw new BadRequestException(
        'That patient has no account here yet, so there is nobody to attribute the message to',
      );
    }

    return {
      id: patient.user.id,
      email: patient.user.email,
      firstName: patient.user.firstName,
      lastName: patient.user.lastName,
      role: patient.user.role,
      tenantId: null,
    };
  }

  /**
   * Whoever is dealing with the visit.
   *
   * The lead clinician, or failing that whoever holds a line on it — on a
   * shared visit only one clinician is named, and a reply that reached nobody
   * because the named one had not been set is the failure this avoids.
   */
  private async clinicianFor(visit: {
    assignedProviderId: string | null;
    items: Array<{ assignedProviderId: string | null }>;
  }): Promise<string> {
    const providerId = visit.assignedProviderId ?? visit.items[0]?.assignedProviderId;
    if (!providerId) {
      throw new BadRequestException(
        'No clinician has this visit yet, so there is no conversation to add to',
      );
    }

    const provider = await runWithoutTenantScope(() =>
      this.prisma.raw.providerProfile.findUnique({
        where: { id: providerId },
        select: { userId: true },
      }),
    );
    if (!provider) throw new BadRequestException('The clinician on this visit no longer exists');
    return provider.userId;
  }

  /**
   * The image, however the client chose to send it.
   *
   * Both forms are accepted because integrators differ and neither is wrong: a
   * client that already stores uploads sends a URL, one that does not sends the
   * bytes. Refusing whichever they chose would be a week of correspondence to
   * settle a detail that costs nothing to support.
   */
  private async readImage(image: NonNullable<PartnerChatInput['image']>) {
    let buffer: Buffer;
    let mime = image.mime ?? '';
    let name = image.fileName ?? 'upload';

    if (image.content) {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(image.content.trim());
      const base64 = match ? match[2] : image.content.trim();
      mime ||= match?.[1] ?? 'image/jpeg';
      buffer = Buffer.from(base64, 'base64');
      if (!buffer.length) throw new BadRequestException('That image could not be read');
    } else if (image.url) {
      let response: Response;
      try {
        response = await fetch(image.url, { signal: AbortSignal.timeout(15_000) });
      } catch {
        throw new BadRequestException('We could not fetch that image');
      }
      if (!response.ok) {
        throw new BadRequestException(`We could not fetch that image (${response.status})`);
      }
      mime ||= response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      buffer = Buffer.from(await response.arrayBuffer());
      name = image.fileName ?? image.url.split('/').pop()?.split('?')[0] ?? 'upload';
    } else {
      throw new BadRequestException('Send the image as a url or as base64 content');
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('That image is too large');
    }
    if (!ALLOWED_MIME.has(mime)) {
      throw new BadRequestException(`Images only — ${mime} is not accepted`);
    }

    return { originalname: name, buffer, size: buffer.length, mimetype: mime };
  }
}
