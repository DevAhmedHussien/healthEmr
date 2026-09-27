import { ForbiddenException, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PHARMACY_ORDER_STATUSES, csvFilter, csvValues } from '@health-emr/types';
import type {
  FlagOrderIssueInput,
  PharmacyOrderTableQuery,
  PharmacyQueueQuery,
  ShipOrderInput,
  TrackingUpdateInput,
} from '@health-emr/types';
import {
  buildOrderBy,
  listResponse,
  offsetSkipTake,
  safeSort,
} from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';

/** What the fill queue may be sorted by, each one indexed. */
export const ORDER_SORT = ['createdAt', 'status', 'submittedAt'] as const;

/**
 * Filterable columns of the dispensary queue, keyed by the column id.
 *
 * `status`, `carrier` and `state` are absent: the endpoint already takes each of
 * them as a multi-value parameter, which is a better fit for a worklist than a
 * single-value box, and redeclaring them here would shadow that.
 */
export const ORDER_FILTERS = {
  medication: { path: 'prescription.medication.name', kind: 'text' },
  patient: {
    path: 'prescription.patient.lastName',
    kind: 'name',
    paths: ['prescription.patient.firstName', 'prescription.patient.lastName'],
  },
  phone: { path: 'prescription.patient.phone', kind: 'text' },
  prescriber: { path: 'prescription.providerNameSnapshot', kind: 'text' },
  directions: { path: 'prescription.sig', kind: 'text' },
  orderId: { path: 'externalOrderId', kind: 'text' },
  tracking: { path: 'trackingNumber', kind: 'text' },
  // One column, five address fields behind it.
  shipTo: {
    path: 'prescription.patient.city',
    kind: 'name',
    paths: [
      'prescription.patient.addressLine1',
      'prescription.patient.addressLine2',
      'prescription.patient.city',
      'prescription.patient.residenceState',
      'prescription.patient.postalCode',
    ],
  },
  patientState: { path: 'prescription.patient.residenceState', kind: 'exact' },
  daysSupply: { path: 'prescription.daysSupply', kind: 'number' },
  dose: { path: 'prescription.dose', kind: 'text' },
  createdAt: { path: 'createdAt', kind: 'date' },
  submittedAt: { path: 'submittedAt', kind: 'date' },
  signedAt: { path: 'prescription.signedAt', kind: 'date' },
} as const satisfies ColumnFilterMap;
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { DomainEvent } from '@/shared/events/domain-events';
import { NotificationsService } from '@/contexts/notifications/notifications.service';
import { keysetWhere, toKeysetPage } from '@/shared/http/pagination';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

@Injectable()
export class FulfilmentService {
  private readonly logger = new Logger(FulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The pharmacy's fill queue.
   *
   * Note what a pharmacy sees and what it does not: enough to dispense safely —
   * the drug, the directions, the prescriber, the allergies, the ship-to — and
   * nothing about why the patient sought care. The questionnaire, the provider's
   * notes and the clinical images are not theirs to read.
   */
  /**
   * The fill queue as a page of a table.
   *
   * Search covers everything on the row, because a pharmacist looking something
   * up has whatever the caller gave them — a tracking number, an MRN, a drug
   * name, the pharmacy's own order id — and should not have to know which field
   * it is before they can find it.
   */
  async listOrders(pharmacyId: string, query: PharmacyOrderTableQuery) {
    return runWithoutTenantScope(async () => {
      // Each of these takes several values at once: a pharmacist asking "what is
      // queued or submitted" is one question, not two searches.
      const statuses = csvFilter(query.status, PHARMACY_ORDER_STATUSES);
      const carriers = csvValues(query.carrier);
      const states = csvValues(query.state);

      const where: Prisma.PharmacyOrderWhereInput = {
        pharmacyId,
        ...(statuses
          ? { status: statuses as never }
          : query.scope === 'open'
            ? { status: { in: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'] } }
            : {}),
        ...(carriers ? { carrier: carriers } : {}),
        ...(states ? { prescription: { patient: { residenceState: states } } } : {}),
        ...(query.q
          ? {
              OR: [
                { externalOrderId: { contains: query.q, mode: 'insensitive' } },
                { externalRxNumber: { contains: query.q, mode: 'insensitive' } },
                { trackingNumber: { contains: query.q, mode: 'insensitive' } },
                { carrier: { contains: query.q, mode: 'insensitive' } },
                { prescription: { sig: { contains: query.q, mode: 'insensitive' } } },
                { prescription: { providerNameSnapshot: { contains: query.q, mode: 'insensitive' } } },
                { prescription: { medication: { name: { contains: query.q, mode: 'insensitive' } } } },
                { prescription: { patient: { mrn: { contains: query.q, mode: 'insensitive' } } } },
                { prescription: { patient: { firstName: { contains: query.q, mode: 'insensitive' } } } },
                { prescription: { patient: { lastName: { contains: query.q, mode: 'insensitive' } } } },
                { prescription: { patient: { city: { contains: query.q, mode: 'insensitive' } } } },
                { prescription: { patient: { residenceState: { contains: query.q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        ...columnFilterWhere(query, ORDER_FILTERS),
      };

      const sort = safeSort(query.sort, ORDER_SORT, 'createdAt');

      const [rows, total] = await Promise.all([
        this.prisma.raw.pharmacyOrder.findMany({
          where,
          orderBy: buildOrderBy(sort, query.order),
          ...offsetSkipTake(query),
          include: {
            prescription: {
              select: {
                id: true, dose: true, quantity: true, refills: true, daysSupply: true, sig: true,
                signedAt: true, providerNameSnapshot: true,
                medication: { select: { name: true, strength: true, form: true } },
                patient: {
                  select: {
                    id: true, mrn: true, firstName: true, lastName: true, phone: true,
                    addressLine1: true, city: true, residenceState: true, postalCode: true,
                    allergies: {
                      where: { status: 'ACTIVE' },
                      select: { substance: true, severity: true },
                    },
                  },
                },
              },
            },
          },
        }),
        this.prisma.raw.pharmacyOrder.count({ where }),
        this.prisma.raw.pharmacyOrder.count({ where: { pharmacyId } }),
      ]);

      const data = rows.map((order) => ({
        id: order.id,
        status: order.status,
        queuedAt: order.createdAt.toISOString(),
        submittedAt: order.submittedAt?.toISOString() ?? null,
        externalOrderId: order.externalOrderId,
        externalRxNumber: order.externalRxNumber,
        carrier: order.carrier,
        trackingNumber: order.trackingNumber,
        /**
         * Whether the order reached this pharmacy's own system, and why not.
         *
         * The error is shown because the pharmacy owns the connection: an
         * expired password or a changed endpoint is theirs to fix, and hiding
         * the reason leaves them with an order that never arrives and no idea
         * why. It is written in words rather than as a raw exception.
         */
        reachedYourSystem: Boolean(order.submittedAt),
        transmissionError: order.lastError,
        medication: order.prescription.medication.name,
        strength: order.prescription.medication.strength,
        dose: order.prescription.dose,
        quantity: order.prescription.quantity,
        refills: order.prescription.refills,
        daysSupply: order.prescription.daysSupply,
        directions: order.prescription.sig,
        prescriber: order.prescription.providerNameSnapshot,
        signedAt: order.prescription.signedAt.toISOString(),
        patient: {
          name: `${order.prescription.patient.firstName} ${order.prescription.patient.lastName}`,
          mrn: order.prescription.patient.mrn,
          phone: order.prescription.patient.phone,
          shipTo: [
            order.prescription.patient.addressLine1,
            order.prescription.patient.city,
            order.prescription.patient.residenceState,
            order.prescription.patient.postalCode,
          ]
            .filter(Boolean)
            .join(', '),
          state: order.prescription.patient.residenceState,
          // Carried on the row, not behind a click: a pharmacist checking a fill
          // should not have to open anything to see the patient has an allergy.
          allergies: order.prescription.patient.allergies.map((allergy) => allergy.substance),
        },
      }));

      return listResponse(data, total, query, ORDER_SORT);
    });
  }

  async queue(pharmacyId: string, query: PharmacyQueueQuery) {
    return runWithoutTenantScope(async () => {
      const rows = await this.prisma.raw.pharmacyOrder.findMany({
        where: {
          pharmacyId,
          status: query.status
            ? (query.status as never)
            : { in: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'] },
          ...(query.search
            ? {
                OR: [
                  { externalOrderId: { contains: query.search, mode: 'insensitive' } },
                  { prescription: { patient: { mrn: { contains: query.search, mode: 'insensitive' } } } },
                  { prescription: { patient: { lastName: { contains: query.search, mode: 'insensitive' } } } },
                ],
              }
            : {}),
          ...(keysetWhere(query.cursor, 'createdAt', query.order) ?? {}),
        },
        orderBy: [{ createdAt: query.order }, { id: query.order }],
        take: query.limit + 1,
        include: {
          prescription: {
            select: {
              id: true, dose: true, quantity: true, refills: true, daysSupply: true, sig: true,
              signedAt: true, providerNameSnapshot: true, licenseNumberSnapshot: true,
              licenseStateSnapshot: true,
              medication: { select: { name: true, strength: true, form: true } },
              patient: {
                select: {
                  id: true, mrn: true, firstName: true, lastName: true,
                  addressLine1: true, addressLine2: true, city: true,
                  residenceState: true, postalCode: true, phone: true,
                  allergies: {
                    where: { status: 'ACTIVE' },
                    select: { substance: true, severity: true, reactionText: true },
                  },
                },
              },
            },
          },
        },
      });

      const page = toKeysetPage(rows, query.limit, 'createdAt');

      return {
        data: page.data.map((order) => ({
          id: order.id,
          orderId: order.id,
          status: order.status,
          queuedAt: order.createdAt,
          trackingNumber: order.trackingNumber,
          carrier: order.carrier,
          prescription: {
            id: order.prescription.id,
            medication: order.prescription.medication.name,
            strength: order.prescription.medication.strength,
            form: order.prescription.medication.form,
            dose: order.prescription.dose,
            quantity: order.prescription.quantity,
            refills: order.prescription.refills,
            daysSupply: order.prescription.daysSupply,
            directions: order.prescription.sig,
            signedAt: order.prescription.signedAt,
            prescriber: order.prescription.providerNameSnapshot,
            licence: `${order.prescription.licenseNumberSnapshot} (${order.prescription.licenseStateSnapshot})`,
          },
          patient: {
            mrn: order.prescription.patient.mrn,
            name: `${order.prescription.patient.firstName} ${order.prescription.patient.lastName}`,
            phone: order.prescription.patient.phone,
            shipTo: {
              line1: order.prescription.patient.addressLine1,
              line2: order.prescription.patient.addressLine2,
              city: order.prescription.patient.city,
              state: order.prescription.patient.residenceState,
              postalCode: order.prescription.patient.postalCode,
            },
            // Safety-critical, so always shown.
            allergies: order.prescription.patient.allergies,
          },
        })),
        pageInfo: page.pageInfo,
      };
    });
  }

  /**
   * Records carrier and tracking, marks the order shipped, and tells everyone
   * who needs to know.
   */
  async ship(pharmacyId: string, orderId: string, actorUserId: string, input: ShipOrderInput) {
    return runWithoutTenantScope(async () => {
      const order = await this.mustOwn(pharmacyId, orderId);

      if (order.status === 'SHIPPED' || order.status === 'DELIVERED') {
        throw new BadRequestException('This order has already shipped');
      }
      if (order.status === 'REJECTED' || order.status === 'CANCELLED') {
        throw new BadRequestException(`Cannot ship a ${order.status.toLowerCase()} order`);
      }

      const shippedAt = input.shippedAt ? new Date(input.shippedAt) : new Date();

      const updated = await this.prisma.raw.$transaction(async (tx) => {
        const result = await tx.pharmacyOrder.update({
          where: { id: orderId },
          data: {
            status: 'SHIPPED',
            carrier: input.carrier,
            trackingNumber: input.trackingNumber.replace(/\s/g, ''),
            shippedAt,
          },
          select: { id: true, trackingNumber: true, carrier: true, shippedAt: true },
        });

        await tx.prescription.update({
          where: { id: order.prescriptionId },
          data: { status: 'SHIPPED' },
        });

        return result;
      });

      await this.audit.record({
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'PharmacyOrder',
        entityId: orderId,
        patientId: order.prescription.patientId,
        tenantId: order.tenantId,
        before: { status: order.status },
        after: { status: 'SHIPPED', carrier: input.carrier, trackingNumber: updated.trackingNumber },
      });

      await this.notifyPatientShipped(order, updated);

      this.events.publish(DomainEvent.OrderShipped, {
        orderId,
        prescriptionId: order.prescriptionId,
        patientId: order.prescription.patientId,
        carrier: updated.carrier,
        trackingNumber: updated.trackingNumber,
      });

      return updated;
    });
  }

  /**
   * Where the parcel got to, reported by the pharmacy.
   *
   * The pharmacy is the only party here who talks to the carrier, so this is
   * where carrier truth enters the system. Until now "shipped" was the last
   * thing anyone was told, which meant the commonest question a patient asks —
   * where is it — had no answer on either side of the integration.
   *
   * Delivery is the one status that changes the order, because it ends it.
   * The other three are reports about a parcel still in motion: they are worth
   * relaying and worth recording, and they are not decisions.
   */
  async trackingUpdate(
    pharmacyId: string,
    orderId: string,
    actorUserId: string,
    input: TrackingUpdateInput,
  ) {
    return runWithoutTenantScope(async () => {
      const order = await this.mustOwn(pharmacyId, orderId);

      if (order.status === 'REJECTED' || order.status === 'CANCELLED') {
        throw new BadRequestException(
          `This order was ${order.status.toLowerCase()} — there is no parcel to track`,
        );
      }
      if (!order.shippedAt) {
        throw new BadRequestException('Record the shipment first, then its progress');
      }

      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const delivered = input.status === 'PACKAGE_DELIVERED';

      if (delivered && order.status !== 'DELIVERED') {
        await this.prisma.raw.$transaction(async (tx) => {
          await tx.pharmacyOrder.update({
            where: { id: orderId },
            data: { status: 'DELIVERED', deliveredAt: occurredAt },
          });
          await tx.prescription.update({
            where: { id: order.prescriptionId },
            data: { status: 'DELIVERED' },
          });
        });
      }

      await this.audit.record({
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'PharmacyOrder',
        entityId: orderId,
        patientId: order.prescription.patientId,
        tenantId: order.tenantId,
        actorUserId,
        before: { status: order.status },
        after: {
          trackingStatus: input.status,
          ...(delivered ? { status: 'DELIVERED' } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      });

      await this.notifyPatientTracked(order, input, occurredAt);

      this.events.publish(DomainEvent.PackageTracked, {
        orderId,
        status: input.status,
        occurredAt: occurredAt.toISOString(),
        trackerStatus: input.trackerStatus ?? null,
        trackerId: input.trackerId ?? null,
        trackingUrl: input.trackingUrl ?? null,
      });

      // Sent alongside, not instead: a client subscribed to the order lifecycle
      // should not have to learn the tracking vocabulary to find out an order
      // finished. This is the publisher that event had been waiting for.
      if (delivered && order.status !== 'DELIVERED') {
        this.events.publish(DomainEvent.OrderDelivered, {
          orderId,
          prescriptionId: order.prescriptionId,
          patientId: order.prescription.patientId,
          deliveredAt: occurredAt.toISOString(),
        });
      }

      return { id: orderId, status: input.status, occurredAt: occurredAt.toISOString() };
    });
  }

  /**
   * The patient's tracking notice.
   *
   * In-app only, and only for the two statuses worth interrupting somebody for.
   * A push for every carrier scan is how people turn notifications off, and the
   * one that mattered — nobody was home, collect it or it goes back — is the one
   * they would then miss.
   */
  private async notifyPatientTracked(
    order: { prescription: { patientId: string }; tenantId: string },
    input: TrackingUpdateInput,
    occurredAt: Date,
  ) {
    const worthSaying: Partial<Record<TrackingUpdateInput['status'], { title: string; body: string }>> = {
      PACKAGE_DELIVERED: {
        title: 'Your medication has been delivered',
        body: `It was delivered on ${occurredAt.toLocaleDateString('en-US')}.`,
      },
      PACKAGE_DELIVERY_FAILED: {
        title: 'Your delivery could not be completed',
        body: input.note?.trim() || 'The carrier could not deliver it. Check your tracking for what to do next.',
      },
    };

    const say = worthSaying[input.status];
    if (!say) return;

    const patient = await this.prisma.raw.patient.findUnique({
      where: { id: order.prescription.patientId },
      select: { id: true, userId: true },
    });
    if (!patient?.userId) return;

    await this.notifications.notify({
      userId: patient.userId,
      tenantId: order.tenantId,
      patientId: patient.id,
      kind: 'order.tracking',
      title: say.title,
      body: say.body,
      safeTitle: 'You have a new update',
      safeBody: 'There is an update on your order. Sign in to your portal to view the details.',
      link: '/portal/prescriptions',
      entityType: 'PharmacyOrder',
      entityId: patient.id,
      channels: ['IN_APP'],
    });
  }

  /**
   * The patient's shipment notice.
   *
   * Two versions on purpose. In-app names the medication and the tracking
   * number, because the reader has authenticated. Email and SMS say only that
   * there is an update and where to see it — a text naming a weight-loss drug is
   * a disclosure to whoever is looking at the lock screen.
   */
  private async notifyPatientShipped(
    order: { prescription: { patientId: string; medication: { name: string } } ; tenantId: string },
    shipment: { carrier: string | null; trackingNumber: string | null },
  ) {
    const patient = await this.prisma.raw.patient.findUnique({
      where: { id: order.prescription.patientId },
      select: { id: true, userId: true },
    });
    if (!patient?.userId) return;

    await this.notifications.notify({
      userId: patient.userId,
      tenantId: order.tenantId,
      patientId: patient.id,
      kind: 'order.shipped',
      title: 'Your medication is on its way',
      body:
        `${order.prescription.medication.name} has shipped via ${shipment.carrier}. ` +
        `Tracking number ${shipment.trackingNumber}.`,
      safeTitle: 'You have a new update',
      safeBody: 'There is an update on your order. Sign in to your portal to view the details.',
      link: '/portal/prescriptions',
      data: { carrier: shipment.carrier, trackingNumber: shipment.trackingNumber },
      entityType: 'PharmacyOrder',
      entityId: order.prescription.patientId,
      channels: ['IN_APP', 'EMAIL', 'SMS'],
    });
  }

  /** Pharmacy raises a problem. Opens a support thread with Super Admin. */
  async flagIssue(pharmacyId: string, orderId: string, actorUserId: string, input: FlagOrderIssueInput) {
    return runWithoutTenantScope(async () => {
      const order = await this.mustOwn(pharmacyId, orderId);

      const superAdmins = await this.prisma.raw.user.findMany({
        where: { role: 'SUPER_ADMIN', isActive: true },
        select: { id: true },
      });

      const thread = await this.prisma.raw.$transaction(async (tx) => {
        const created = await tx.chatThread.create({
          data: {
            kind: 'PHARMACY_SUPPORT',
            tenantId: order.tenantId,
            patientId: order.prescription.patientId,
            prescriptionId: order.prescriptionId,
            pharmacyOrderId: orderId,
            subject: `${input.reason.replace(/_/g, ' ').toLowerCase()} — order ${orderId.slice(0, 8)}`,
            containsPhi: true,
            lastMessageAt: new Date(),
            participants: {
              create: [
                { userId: actorUserId, role: 'PHARMACY' },
                ...superAdmins.map((admin) => ({ userId: admin.id, role: 'SUPER_ADMIN' as const })),
              ],
            },
            messages: {
              create: {
                authorUserId: actorUserId,
                authorRole: 'PHARMACY',
                kind: 'TEXT',
                content: input.message,
              },
            },
          },
          select: { id: true },
        });

        await tx.pharmacyOrder.update({
          where: { id: orderId },
          data: { lastError: `${input.reason}: ${input.message.slice(0, 200)}` },
        });

        return created;
      });

      await this.audit.record({
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'PharmacyOrder',
        entityId: orderId,
        patientId: order.prescription.patientId,
        tenantId: order.tenantId,
        after: { issueRaised: input.reason, threadId: thread.id },
      });

      for (const admin of superAdmins) {
        await this.notifications.notify({
          userId: admin.id,
          tenantId: order.tenantId,
          kind: 'pharmacy.issue',
          title: `Pharmacy raised an issue: ${input.reason.replace(/_/g, ' ').toLowerCase()}`,
          body: input.message,
          safeTitle: 'You have a new update',
          safeBody: 'A pharmacy has raised an issue. Sign in to view.',
          link: `/system/chat/${thread.id}`,
          entityType: 'ChatThread',
          entityId: thread.id,
          channels: ['IN_APP', 'EMAIL'],
        });
      }

      return { threadId: thread.id, orderId };
    });
  }

  private async mustOwn(pharmacyId: string, orderId: string) {
    const order = await this.prisma.raw.pharmacyOrder.findUnique({
      where: { id: orderId },
      include: {
        prescription: { select: { patientId: true, medication: { select: { name: true } } } },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.pharmacyId !== pharmacyId) {
      throw new ForbiddenException('This order belongs to another pharmacy');
    }
    return order;
  }

  /**
   * Resolves the signed-in pharmacy user to the pharmacy they work for.
   *
   * Via the foreign key, not by comparing their email to the pharmacy's contact
   * address: that earlier rule meant editing either field locked the account
   * out of its own queue, and it could not express two staff at one pharmacy.
   */
  async pharmacyIdForUser(userId: string): Promise<string> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      select: { pharmacyId: true },
    });

    if (!user?.pharmacyId) {
      throw new ForbiddenException('This account is not linked to a pharmacy');
    }
    return user.pharmacyId;
  }
}
