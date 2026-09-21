import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser, OpenThreadInput, SendMessageInput, ThreadListQuery } from '@health-emr/types';
import { Role } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { ObjectStorageService } from '@/shared/storage/object-storage.service';
import { validateUpload } from '@/shared/storage/upload.validation';
import { DomainEvent, type DomainEventEnvelope } from '@/shared/events/domain-events';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '@/contexts/notifications/notifications.service';
import { keysetWhere, toKeysetPage } from '@/shared/http/pagination';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * Membership is the authorisation model.
   *
   * There is no "can this role read this thread" rule — only "is this person in
   * it". That is far harder to get wrong than a role matrix, and it means a
   * thread cannot be widened by accident: someone has to be added.
   */
  /** Membership, plus the patient and tenant an attachment has to be filed under. */
  private async threadForParticipant(user: AuthenticatedUser, threadId: string) {
    await this.mustParticipate(user.id, threadId);

    const thread = await runWithoutTenantScope(() =>
      this.prisma.raw.chatThread.findUnique({
        where: { id: threadId },
        select: { patientId: true, tenantId: true },
      }),
    );
    if (!thread) throw new NotFoundException('That conversation does not exist');
    return thread;
  }

  private async mustParticipate(userId: string, threadId: string) {
    const participant = await this.prisma.raw.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
      select: { id: true, leftAt: true, role: true },
    });
    if (!participant || participant.leftAt) {
      throw new ForbiddenException('You are not part of this conversation');
    }
    return participant;
  }

  async listThreads(user: AuthenticatedUser, query: ThreadListQuery) {
    return runWithoutTenantScope(async () => {
      const rows = await this.prisma.raw.chatThread.findMany({
        where: {
          participants: { some: { userId: user.id, leftAt: null } },
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.patientId ? { patientId: query.patientId } : {}),
          ...(keysetWhere(query.cursor, 'lastMessageAt', query.order) ?? {}),
        },
        orderBy: [{ lastMessageAt: query.order }, { id: query.order }],
        take: query.limit + 1,
        include: {
          patient: { select: { mrn: true, firstName: true, lastName: true } },
          participants: {
            where: { leftAt: null },
            select: { userId: true, role: true, lastReadAt: true },
          },
          messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { sentAt: true, authorRole: true } },
        },
      });

      const page = toKeysetPage(rows, query.limit, 'lastMessageAt');

      return {
        data: page.data.map((thread) => {
          const me = thread.participants.find((p) => p.userId === user.id);
          const last = thread.messages[0];
          return {
            id: thread.id,
            kind: thread.kind,
            subject: thread.subject,
            status: thread.status,
            patient: thread.patient
              ? { mrn: thread.patient.mrn, name: `${thread.patient.firstName} ${thread.patient.lastName}` }
              : null,
            participantCount: thread.participants.length,
            lastMessageAt: thread.lastMessageAt,
            unread: Boolean(last && (!me?.lastReadAt || last.sentAt > me.lastReadAt)),
          };
        }),
        pageInfo: page.pageInfo,
      };
    });
  }

  async messages(user: AuthenticatedUser, threadId: string, limit = 50) {
    await this.mustParticipate(user.id, threadId);

    return runWithoutTenantScope(async () => {
      const rows = await this.prisma.raw.chatMessage.findMany({
        where: { threadId },
        orderBy: { sentAt: 'desc' },
        take: Math.min(limit, 200),
        include: {
          author: { select: { firstName: true, lastName: true } },
          // Ids and types only. The bytes come from the attachment endpoint,
          // one read at a time, each recorded against the chart.
          attachments: { select: { id: true, mime: true, size: true, fileName: true } },
        },
      });

      // Reading a thread is a PHI access event in its own right.
      const thread = await this.prisma.raw.chatThread.findUnique({
        where: { id: threadId },
        select: { patientId: true, tenantId: true },
      });
      await this.audit.record({
        action: 'PHI_READ',
        entityType: 'ChatThread',
        entityId: threadId,
        patientId: thread?.patientId ?? null,
        tenantId: thread?.tenantId ?? null,
      });

      await this.prisma.raw.chatParticipant.update({
        where: { threadId_userId: { threadId, userId: user.id } },
        data: { lastReadAt: new Date() },
      });

      return rows
        .map((message) => ({
          id: message.id,
          author: message.author
            ? `${message.author.firstName} ${message.author.lastName}`
            : 'System',
          authorRole: message.authorRole,
          kind: message.kind,
          content: this.phi.decrypt(message.content),
          sentAt: message.sentAt,
          mine: message.authorUserId === user.id,
          attachments: message.attachments,
        }))
        .reverse();
    });
  }

  async send(user: AuthenticatedUser, threadId: string, input: SendMessageInput) {
    await this.mustParticipate(user.id, threadId);

    return runWithoutTenantScope(async () => {
      const thread = await this.prisma.raw.chatThread.findUnique({
        where: { id: threadId },
        include: { participants: { where: { leftAt: null }, select: { userId: true } } },
      });
      if (!thread) throw new NotFoundException('Conversation not found');
      if (thread.status === 'LOCKED') {
        throw new BadRequestException('This conversation is locked');
      }

      const sentAt = new Date();
      const message = await this.prisma.raw.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            threadId,
            authorUserId: user.id,
            authorRole: user.role,
            kind: 'TEXT',
            // Message bodies are free text between clinicians and patients —
            // among the most sensitive content in the system.
            content: this.phi.encrypt(input.content),
            sentAt,
          },
          select: { id: true, sentAt: true },
        });

        await tx.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: sentAt } });
        await tx.chatParticipant.update({
          where: { threadId_userId: { threadId, userId: user.id } },
          data: { lastReadAt: sentAt },
        });

        return created;
      });

      const payload = {
        threadId,
        messageId: message.id,
        author: `${user.firstName} ${user.lastName}`,
        authorRole: user.role,
        content: input.content,
        sentAt: message.sentAt,
      };
      this.events.publish(DomainEvent.ChatMessageSent, payload);

      for (const participant of thread.participants) {
        if (participant.userId === user.id) continue;
        await this.notifications.notify({
          userId: participant.userId,
          tenantId: thread.tenantId,
          patientId: thread.patientId,
          kind: 'chat.message',
          title: `New message from ${user.firstName} ${user.lastName}`,
          body: input.content,
          safeTitle: 'You have a new message',
          safeBody: 'You have a new secure message. Sign in to read it.',
          link: `/chat/${threadId}`,
          entityType: 'ChatThread',
          entityId: threadId,
          channels: ['IN_APP'],
        });
      }

      return { id: message.id, sentAt: message.sentAt };
    });
  }

  /** Opens a thread. Implied participants are added automatically by kind. */
  /**
   * The patient hears about every step, as it happens.
   *
   * A telehealth patient has paid and then waits, with no counter to go back to
   * and nobody to ask. Silence is the whole complaint — so each milestone posts
   * into their conversation and each one says what happens next.
   *
   * Driven by domain events rather than called from the services that cause
   * them: a messaging failure must never roll back an intake, a signature or a
   * shipment.
   */
  @OnEvent(DomainEvent.VisitReceived)
  async onVisitReceived(envelope: DomainEventEnvelope<{ requestId: string; patientId: string }>) {
    await this.tellPatient(envelope.payload.patientId, [
      'We have your request and a licensed clinician is reviewing it.',
      '',
      'They read what you told us on the form before deciding, so there is nothing more for you ' +
        'to do right now. You will hear here the moment they have.',
    ]);
  }

  @OnEvent(DomainEvent.VisitDenied)
  async onVisitDenied(envelope: DomainEventEnvelope<{ requestId: string }>) {
    const request = await runWithoutTenantScope(() =>
      this.prisma.raw.prescriptionRequest.findUnique({
        where: { id: envelope.payload.requestId },
        select: {
          patientId: true,
          denialReason: true,
          tenant: { select: { name: true } },
        },
      }),
    );
    if (!request) return;

    await this.tellPatient(request.patientId, [
      'A clinician has reviewed your request and decided this treatment is not right for you.',
      ...(request.denialReason ? ['', request.denialReason] : []),
      '',
      // The clinician took no payment and cannot refund one. Sending them to the
      // right desk is the difference between an answer and a dead end.
      `You were not charged for the medication. For anything about your order or a refund, ` +
        `contact ${request.tenant.name}, where you bought it.`,
      '',
      'You can reply here with questions about the clinical decision itself.',
    ]);
  }

  @OnEvent(DomainEvent.OrderSubmitted)
  async onOrderSubmitted(
    envelope: DomainEventEnvelope<{ orderId: string; patientId: string; pharmacy: string }>,
  ) {
    await this.tellPatient(envelope.payload.patientId, [
      `Your prescription has been sent to ${envelope.payload.pharmacy}.`,
      '',
      'They will prepare it and post it to the address on your order. You will get a tracking ' +
        'number here as soon as it leaves them.',
    ]);
  }

  @OnEvent(DomainEvent.OrderShipped)
  async onOrderShipped(
    envelope: DomainEventEnvelope<{
      patientId: string;
      carrier: string | null;
      trackingNumber: string | null;
    }>,
  ) {
    const { carrier, trackingNumber } = envelope.payload;

    await this.tellPatient(envelope.payload.patientId, [
      'Your medication is on its way.',
      ...(trackingNumber
        ? ['', `${carrier ?? 'Carrier'} tracking: ${trackingNumber}`]
        : []),
      '',
      'Reply here if it has not arrived when you expected it, or if anything about it looks wrong.',
    ]);
  }

  /**
   * Posts one update into the patient's conversation.
   *
   * Finds the thread rather than requiring one, and gives up quietly when the
   * patient has no login yet — there is nowhere to post, and an exception here
   * would surface as a failed intake.
   */
  private async tellPatient(patientId: string, lines: string[]): Promise<void> {
    try {
      await runWithoutTenantScope(async () => {
        const patient = await this.prisma.raw.patient.findUnique({
          where: { id: patientId },
          select: { userId: true, tenantLinks: { select: { tenantId: true }, take: 1 } },
        });
        if (!patient?.userId) return;

        const thread = await this.patientThread(
          patientId,
          patient.userId,
          patient.tenantLinks[0]?.tenantId ?? null,
        );
        if (!thread) return;

        const sentAt = new Date();
        await this.prisma.raw.$transaction([
          this.prisma.raw.chatMessage.create({
            data: {
              threadId: thread,
              authorUserId: null,
              authorRole: Role.SUPER_ADMIN,
              kind: 'SYSTEM',
              content: this.phi.encrypt(lines.join('\n')),
              sentAt,
            },
          }),
          this.prisma.raw.chatThread.update({
            where: { id: thread },
            data: { lastMessageAt: sentAt },
          }),
        ]);

        await this.notifications.notify({
          userId: patient.userId,
          patientId,
          kind: 'VISIT_UPDATE',
          title: 'An update on your treatment',
          body: lines[0],
          safeTitle: 'An update on your treatment',
          safeBody: 'Sign in to read it.',
          link: '/portal/messages',
          channels: ['IN_APP'],
        });
      });
    } catch (error) {
      this.logger.error(`Could not post an update for patient ${patientId}`, error as Error);
    }
  }

  /** Their open conversation, opened if this is the first thing to say. */
  private async patientThread(
    patientId: string,
    patientUserId: string,
    tenantId: string | null,
  ): Promise<string | null> {
    const existing = await this.prisma.raw.chatThread.findFirst({
      where: { kind: 'PATIENT_PROVIDER', patientId, status: 'OPEN' },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.raw.chatThread.create({
      data: {
        kind: 'PATIENT_PROVIDER',
        tenantId,
        patientId,
        subject: 'Your treatment',
        containsPhi: true,
        lastMessageAt: new Date(),
        participants: { create: [{ userId: patientUserId, role: Role.PATIENT }] },
      },
      select: { id: true },
    });

    return created.id;
  }

  /**
   * Driven by the signing event rather than called from the prescribing service.
   *
   * Signing is a clinical act and must not fail because messaging is down —
   * the same reason dispatch listens for this instead of being called inline.
   */
  @OnEvent(DomainEvent.PrescriptionSigned)
  async onPrescriptionSigned(envelope: DomainEventEnvelope<{ prescriptionId: string }>) {
    await this.announcePrescription(envelope.payload.prescriptionId);
  }

  /**
   * Tells the patient what was prescribed, in the conversation with their
   * clinician.
   *
   * Posted by the system rather than by the provider, at the moment of
   * signature, so the patient learns what to do from the same record the
   * pharmacy fills — not from a separate summary somebody has to remember to
   * write, and which would be the thing that goes out of date.
   *
   * The directions are quoted from the signed `sig` verbatim rather than rebuilt
   * from the structured fields. Two renderings of one instruction is one too
   * many: the label and the message have to say the same words.
   *
   * Never throws into the caller. A messaging failure must not roll back a
   * signed clinical decision — the prescription is valid whether or not the
   * patient has read about it yet.
   */
  async announcePrescription(prescriptionId: string): Promise<string | null> {
    return runWithoutTenantScope(async () => {
      try {
        const prescription = await this.prisma.raw.prescription.findUnique({
          where: { id: prescriptionId },
          select: {
            id: true,
            sig: true,
            patientNote: true,
            quantity: true,
            refills: true,
            daysSupply: true,
            tenantId: true,
            patientId: true,
            providerNameSnapshot: true,
            medication: { select: { name: true, strength: true } },
            patient: { select: { userId: true } },
            provider: { select: { userId: true } },
          },
        });

        // No login yet means no inbox to post into. The invite goes out at
        // intake; until they accept it there is nowhere for this to land.
        if (!prescription?.patient.userId) return null;

        const thread = await this.threadFor(prescription);
        const content = this.prescriptionMessage(prescription);

        const sentAt = new Date();
        const message = await this.prisma.raw.$transaction(async (tx) => {
          const created = await tx.chatMessage.create({
            data: {
              threadId: thread,
              // No author: this is the system reporting a clinical fact, not the
              // clinician typing. Attributing it to them would imply they wrote
              // these words and could be replied to about the wording.
              authorUserId: null,
              authorRole: Role.PROVIDER,
              kind: 'SYSTEM',
              content: this.phi.encrypt(content),
              sentAt,
            },
            select: { id: true },
          });

          await tx.chatThread.update({
            where: { id: thread },
            data: { lastMessageAt: sentAt, prescriptionId: prescription.id },
          });

          return created;
        });

        await this.notifications.notify({
          userId: prescription.patient.userId,
          tenantId: prescription.tenantId,
          patientId: prescription.patientId,
          kind: 'PRESCRIPTION_READY',
          // In-app only, behind their login.
          title: `${prescription.medication.name} has been prescribed`,
          body: 'Your clinician has sent instructions for taking it.',
          // What email and SMS may say. Naming the medication in an email
          // discloses a condition to whoever else reads that inbox.
          safeTitle: 'A message from your clinician',
          safeBody: 'Sign in to read it.',
          link: '/portal/messages',
          entityType: 'Prescription',
          entityId: prescription.id,
          channels: ['IN_APP', 'EMAIL'],
        });

        return message.id;
      } catch (error) {
        this.logger.error(
          `Could not tell the patient about prescription ${prescriptionId}`,
          error as Error,
        );
        return null;
      }
    });
  }

  /** The patient's existing conversation with their clinician, or a new one. */
  /**
   * A photograph, posted into the conversation.
   *
   * This is the answer to "send me a picture of the injection site". It goes
   * into the thread, which means it goes into the chart — the clinician
   * prescribes against it and it stays with the record. A photograph sent by
   * text instead would live in a carrier's network and the patient's gallery,
   * and the one place it would not be is the chart.
   *
   * The file itself never sits in the message body: bodies are encrypted and
   * read on every page of a conversation, and a 15MB image in each of them
   * would make the thread unusable.
   */
  async attach(
    user: AuthenticatedUser,
    threadId: string,
    file: { originalname: string; buffer: Buffer; size: number; mimetype: string },
    caption?: string,
  ): Promise<{ id: string; attachmentId: string; sentAt: Date }> {
    const thread = await this.threadForParticipant(user, threadId);
    const { mime } = validateUpload(file);

    const objectKey = this.storage.buildKey(`chat/${threadId}`, file.originalname);
    const stored = await this.storage.put('chat-attachments', objectKey, file.buffer, mime);

    const sentAt = new Date();

    const message = await runWithoutTenantScope(() =>
      this.prisma.raw.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            threadId,
            authorUserId: user.id,
            authorRole: user.role,
            kind: 'MEDIA',
            // The caption, not the file. Encrypted like any other body.
            content: this.phi.encrypt(caption?.trim() || 'Sent a photograph'),
            sentAt,
          },
          select: { id: true, sentAt: true },
        });

        const attachment = await tx.chatAttachment.create({
          data: {
            messageId: created.id,
            bucket: stored.bucket,
            objectKey: stored.objectKey,
            mime: stored.mime,
            size: stored.size,
            fileName: file.originalname.slice(0, 255),
          },
          select: { id: true },
        });

        await tx.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: sentAt } });

        return { ...created, attachmentId: attachment.id };
      }),
    );

    await this.audit.record({
      action: 'PHI_CREATED',
      entityType: 'ChatAttachment',
      entityId: message.attachmentId,
      patientId: thread.patientId,
      tenantId: thread.tenantId,
      actorUserId: user.id,
      actorRole: user.role,
      after: { mime: stored.mime, size: stored.size },
    });

    this.events.publish(DomainEvent.ChatMessageSent, {
      threadId,
      messageId: message.id,
      author: `${user.firstName} ${user.lastName}`,
      authorRole: user.role,
      content: caption?.trim() || 'Sent a photograph',
      sentAt: message.sentAt,
    });

    return { id: message.id, attachmentId: message.attachmentId, sentAt: message.sentAt };
  }

  /**
   * The bytes of one attachment, for somebody already in the conversation.
   *
   * Scoped through the thread, so an attachment id on its own opens nothing —
   * and recorded, because looking at a patient's photograph is a look at their
   * chart whatever the interface calls it.
   */
  async attachment(
    user: AuthenticatedUser,
    threadId: string,
    attachmentId: string,
  ): Promise<{ body: Buffer; mime: string; fileName: string }> {
    const thread = await this.threadForParticipant(user, threadId);

    const attachment = await runWithoutTenantScope(() =>
      this.prisma.raw.chatAttachment.findFirst({
        where: { id: attachmentId, message: { threadId } },
        select: { bucket: true, objectKey: true, mime: true, fileName: true },
      }),
    );
    if (!attachment) throw new NotFoundException('That attachment is not in this conversation');

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'ChatAttachment',
      entityId: attachmentId,
      patientId: thread.patientId,
      tenantId: thread.tenantId,
      actorUserId: user.id,
      actorRole: user.role,
    });

    return {
      body: await this.storage.get(attachment.bucket, attachment.objectKey),
      mime: attachment.mime,
      fileName: attachment.fileName ?? 'attachment',
    };
  }

  /**
   * Writes a message into a thread on somebody's behalf and nudges the patient.
   *
   * The nudge deliberately says nothing clinical. A patient asked "can you send
   * a photograph of the injection site" wants that question in the app, not on
   * a lock screen in front of whoever is standing next to them — so the text
   * says only that there is something to read, and where.
   */
  async postSystemMessage(
    threadId: string,
    content: string,
    author: { authorUserId: string | null; authorRole: Role },
  ): Promise<void> {
    const sentAt = new Date();

    const thread = await runWithoutTenantScope(() =>
      this.prisma.raw.chatThread.findUnique({
        where: { id: threadId },
        select: {
          tenantId: true,
          patientId: true,
          participants: { select: { userId: true, role: true } },
        },
      }),
    );
    if (!thread) return;

    await runWithoutTenantScope(() =>
      this.prisma.raw.$transaction([
        this.prisma.raw.chatMessage.create({
          data: {
            threadId,
            authorUserId: author.authorUserId,
            authorRole: author.authorRole,
            kind: 'TEXT',
            content: this.phi.encrypt(content),
            sentAt,
          },
        }),
        this.prisma.raw.chatThread.update({
          where: { id: threadId },
          data: { lastMessageAt: sentAt },
        }),
      ]),
    );

    const patient = thread.participants.find((row) => row.role === Role.PATIENT);
    if (!patient) return;

    await this.notifications.notify({
      userId: patient.userId,
      tenantId: thread.tenantId,
      patientId: thread.patientId,
      kind: 'INFO_REQUESTED',
      title: 'Your clinician has a question',
      body: content,
      safeTitle: 'Your clinician has a question',
      // Content-free on purpose: this is what email and SMS are allowed to say.
      safeBody: 'Sign in to read it and reply.',
      link: '/portal/messages',
      channels: ['IN_APP', 'EMAIL', 'SMS'],
    });
  }

  /**
   * The conversation between this patient and this clinician, opened if needed.
   *
   * Public because a clinician now reaches for it before prescribing as well as
   * after — asking a question about the chart is the same conversation as
   * explaining what was prescribed, and splitting them into two threads would
   * leave the patient answering in one and reading in the other.
   */
  async openPatientThread(params: {
    tenantId: string;
    patientId: string;
    patientUserId: string;
    providerUserId: string;
  }): Promise<string> {
    return this.threadFor({
      tenantId: params.tenantId,
      patientId: params.patientId,
      patient: { userId: params.patientUserId },
      provider: { userId: params.providerUserId },
    });
  }

  private async threadFor(prescription: {
    tenantId: string;
    patientId: string;
    patient: { userId: string | null };
    provider: { userId: string };
  }): Promise<string> {
    const existing = await this.prisma.raw.chatThread.findFirst({
      where: { kind: 'PATIENT_PROVIDER', patientId: prescription.patientId, status: 'OPEN' },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });

    if (existing) {
      // The clinician who signed this may not be the one on an older thread.
      // Added rather than swapped: the earlier conversation is still theirs too.
      await this.prisma.raw.chatParticipant.upsert({
        where: { threadId_userId: { threadId: existing.id, userId: prescription.provider.userId } },
        create: { threadId: existing.id, userId: prescription.provider.userId, role: Role.PROVIDER },
        update: { leftAt: null },
      });
      return existing.id;
    }

    const created = await this.prisma.raw.chatThread.create({
      data: {
        kind: 'PATIENT_PROVIDER',
        tenantId: prescription.tenantId,
        patientId: prescription.patientId,
        subject: 'Your treatment',
        containsPhi: true,
        lastMessageAt: new Date(),
        participants: {
          create: [
            { userId: prescription.patient.userId as string, role: Role.PATIENT },
            { userId: prescription.provider.userId, role: Role.PROVIDER },
          ],
        },
      },
      select: { id: true },
    });

    return created.id;
  }

  /**
   * What the patient reads.
   *
   * Plain sentences, not a form. Someone who has just been prescribed an
   * injectable needs to know what it is, how to take it, how long for, and what
   * their clinician wanted to say to them — in that order, because that is the
   * order they will ask.
   */
  private prescriptionMessage(prescription: {
    sig: string;
    patientNote: string | null;
    quantity: string;
    refills: number;
    daysSupply: number | null;
    providerNameSnapshot: string;
    medication: { name: string; strength: string | null };
  }): string {
    const name = [prescription.medication.name, prescription.medication.strength]
      .filter(Boolean)
      .join(' ');

    const supply = [
      `${prescription.quantity} supplied`,
      prescription.daysSupply ? `${prescription.daysSupply} days` : null,
      prescription.refills > 0 ? `${prescription.refills} refills` : 'no refills',
    ]
      .filter(Boolean)
      .join(' · ');

    return [
      `${prescription.providerNameSnapshot} has prescribed ${name}.`,
      '',
      `How to take it: ${prescription.sig}`,
      supply,
      ...(prescription.patientNote
        ? ['', `From your clinician: ${prescription.patientNote}`]
        : []),
      '',
      'Reply here if anything is unclear or you feel unwell.',
    ].join('\n');
  }

  async openThread(user: AuthenticatedUser, input: OpenThreadInput) {
    return runWithoutTenantScope(async () => {
      const participantIds = new Set<string>([user.id, ...input.participantUserIds]);

      if (input.kind === 'PATIENT_PROVIDER' && input.patientId) {
        const patient = await this.prisma.raw.patient.findUnique({
          where: { id: input.patientId },
          select: { userId: true },
        });
        if (patient?.userId) participantIds.add(patient.userId);
      }

      if (input.kind === 'PHARMACY_SUPPORT' || input.kind === 'PROVIDER_SUPPORT') {
        const admins = await this.prisma.raw.user.findMany({
          where: { role: Role.SUPER_ADMIN, isActive: true },
          select: { id: true },
        });
        admins.forEach((admin) => participantIds.add(admin.id));
      }

      const users = await this.prisma.raw.user.findMany({
        where: { id: { in: [...participantIds] }, isActive: true },
        select: { id: true, role: true },
      });

      const tenantId =
        input.patientId && user.tenantId
          ? user.tenantId
          : input.patientId
            ? (
                await this.prisma.raw.tenantPatient.findFirst({
                  where: { patientId: input.patientId },
                  select: { tenantId: true },
                })
              )?.tenantId ?? null
            : null;

      const thread = await this.prisma.raw.chatThread.create({
        data: {
          kind: input.kind,
          tenantId,
          patientId: input.patientId ?? null,
          prescriptionId: input.prescriptionId ?? null,
          subject: input.subject ?? null,
          containsPhi: Boolean(input.patientId),
          lastMessageAt: new Date(),
          participants: { create: users.map((u) => ({ userId: u.id, role: u.role })) },
          messages: {
            create: {
              authorUserId: user.id,
              authorRole: user.role,
              kind: 'TEXT',
              content: this.phi.encrypt(input.message),
            },
          },
        },
        select: { id: true, kind: true },
      });

      await this.audit.record({
        action: 'PHI_CREATED',
        entityType: 'ChatThread',
        entityId: thread.id,
        patientId: input.patientId ?? null,
        tenantId,
        after: { kind: input.kind, participants: users.length },
      });

      return { threadId: thread.id, kind: thread.kind, participants: users.length };
    });
  }
}
