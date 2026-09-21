import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { EmailAdapter } from './channels/email.adapter';
import { SmsAdapter } from './channels/sms.adapter';
import { WebhookAdapter } from './channels/webhook.adapter';
import type { NotificationChannelAdapter } from './channels/channel.interface';

export interface NotifyInput {
  userId: string;
  tenantId?: string | null;
  kind: string;
  /** Shown in-app. May contain PHI. */
  title: string;
  body: string;
  /**
   * What a channel that cannot carry PHI will say instead. Must name no
   * medication, condition, or anything that implies one.
   */
  safeTitle: string;
  safeBody: string;
  /** Where to send the patient to read the real thing. */
  link?: string;
  data?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  channels: NotificationChannel[];
  /** Only set for a patient, and only to check their consent on record. */
  patientId?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly adapters = new Map<string, NotificationChannelAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    email: EmailAdapter,
    sms: SmsAdapter,
    webhook: WebhookAdapter,
  ) {
    for (const adapter of [email, sms, webhook]) {
      this.adapters.set(adapter.channel, adapter);
    }
  }

  /**
   * Records a notification and fans it out.
   *
   * The in-app copy carries the real content. Every other channel gets the safe
   * copy unless the channel is permitted to carry PHI, or the patient has
   * explicitly consented to receiving content on it. That default is the whole
   * point: it should take a deliberate act to put a medication name into an SMS,
   * not a deliberate act to keep it out.
   */
  async notify(input: NotifyInput): Promise<{ notificationId: string }> {
    const recipient = await this.prisma.raw.user.findUnique({
      where: { id: input.userId },
      select: { email: true, phone: true },
    });

    const consent = input.patientId
      ? await this.prisma.raw.communicationConsent.findUnique({
          where: { patientId: input.patientId },
        })
      : null;

    const notification = await this.prisma.raw.notification.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        deliveries: {
          create: input.channels.map((channel) => ({ channel })),
        },
      },
      include: { deliveries: true },
    });

    for (const delivery of notification.deliveries) {
      // In-app needs no transport: reading the parent row is the delivery.
      if (delivery.channel === 'IN_APP') {
        await this.prisma.raw.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        continue;
      }

      const adapter = this.adapters.get(delivery.channel);
      const target = this.targetFor(delivery.channel, recipient);

      if (!adapter?.enabled || !target) {
        await this.prisma.raw.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SKIPPED',
            error: !target ? 'No address on file for this channel' : 'Channel disabled',
          },
        });
        continue;
      }

      const mayCarryPhi =
        adapter.carriesPhi ||
        (delivery.channel === 'EMAIL' && this.consented(consent, 'email')) ||
        (delivery.channel === 'SMS' && this.consented(consent, 'sms'));

      const subject = mayCarryPhi ? input.title : input.safeTitle;
      const body = mayCarryPhi ? input.body : input.safeBody;

      const result = await adapter.send({
        target,
        subject,
        body,
        link: input.link,
        metadata: input.data,
      });

      await this.prisma.raw.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          target,
          renderedBody: body,
          attempts: { increment: 1 },
          ...(result.ok
            ? { status: 'SENT', sentAt: new Date(), externalId: result.externalId ?? null }
            : { status: 'FAILED', failedAt: new Date(), error: result.error ?? 'Unknown error' }),
        },
      });
    }

    return { notificationId: notification.id };
  }

  /**
   * Sends to a bare email address.
   *
   * An applicant has no account yet — that is the whole point of applying — so
   * there is no user row to hang a notification off. This path exists for them,
   * and only for them.
   *
   * Because the recipient is not authenticated anywhere, there is no "sign in to
   * view" fallback to lean on. So these messages must be written to be safe in
   * the clear from the outset: administrative facts about an application, never
   * anything clinical.
   */
  async notifyEmailAddress(input: {
    to: string;
    subject: string;
    body: string;
    kind: string;
    entityType?: string;
    entityId?: string;
  }): Promise<{ delivered: boolean }> {
    const adapter = this.adapters.get('EMAIL');
    if (!adapter?.enabled) {
      this.logger.warn(`Email adapter disabled; ${input.kind} to ${input.to} not sent`);
      return { delivered: false };
    }

    const result = await adapter.send({
      target: input.to,
      subject: input.subject,
      body: input.body,
    });

    if (!result.ok) {
      this.logger.error(`Failed to email ${input.kind}: ${result.error}`);
    }
    return { delivered: result.ok };
  }

  private consented(
    consent: { emailPhiConsent: boolean; smsPhiConsent: boolean; revokedAt: Date | null } | null,
    channel: 'email' | 'sms',
  ): boolean {
    if (!consent || consent.revokedAt) return false;
    return channel === 'email' ? consent.emailPhiConsent : consent.smsPhiConsent;
  }

  private targetFor(
    channel: NotificationChannel,
    recipient: { email: string; phone: string | null } | null,
  ): string | null {
    if (!recipient) return null;
    if (channel === 'EMAIL') return recipient.email;
    if (channel === 'SMS') return recipient.phone;
    return null;
  }

  async listForUser(userId: string, limit = 25) {
    return this.prisma.raw.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, kind: true, title: true, body: true, data: true,
        entityType: true, entityId: true, readAt: true, createdAt: true,
      },
    });
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.prisma.raw.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async unreadCount(userId: string) {
    return this.prisma.raw.notification.count({ where: { userId, readAt: null } });
  }
}
