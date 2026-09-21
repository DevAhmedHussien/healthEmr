import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import type { Role } from '@health-emr/types';

/**
 * Orders that have not reached a pharmacy's system.
 *
 * A prescription is signed, the patient believes it is on its way, and nothing
 * is happening — because a transmission failed, or because the pharmacy has no
 * integration and nobody is watching their fill queue. Nothing else surfaces
 * these: the pharmacy sees a queue they are not working, and the client sees a
 * visit marked approved.
 */
@Injectable()
export class StuckOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Exactly what we sent the pharmacy, and what came back.
   *
   * Kept on the order at transmission because a pharmacy disputing what it
   * received is otherwise our word against theirs. Surfaced here so that
   * question can be answered from the console instead of from the database.
   *
   * The payload is full PHI — name, date of birth, home address — which is why
   * reading it is recorded as break-the-glass rather than treated as a
   * configuration view.
   */
  async payload(orderId: string, actor: { id: string; role: Role }) {
    const order = await this.prisma.raw.pharmacyOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        attempts: true,
        submittedAt: true,
        externalOrderId: true,
        externalRxNumber: true,
        lastError: true,
        requestPayload: true,
        tenantId: true,
        pharmacy: {
          select: {
            name: true,
            slug: true,
            platform: true,
            config: { select: { baseUrl: true, isEnabled: true } },
          },
        },
        prescription: { select: { patientId: true } },
      },
    });

    if (!order) throw new NotFoundException('That order does not exist');

    await this.audit.record({
      action: 'BREAK_THE_GLASS',
      entityType: 'PharmacyOrder',
      entityId: order.id,
      patientId: order.prescription.patientId,
      tenantId: order.tenantId,
      actorUserId: actor.id,
      actorRole: actor.role,
      after: { read: 'pharmacy request payload', pharmacy: order.pharmacy.slug },
    });

    return {
      orderId: order.id,
      pharmacy: order.pharmacy.name,
      platform: order.pharmacy.platform,
      /**
       * Where it was posted. Null when the pharmacy has no live integration —
       * then there is no payload either, because they work the order in our
       * own console instead.
       */
      endpoint: order.pharmacy.config?.isEnabled
        ? `${order.pharmacy.config.baseUrl.replace(/\/+$/, '')}/order`
        : null,
      status: order.status,
      attempts: order.attempts,
      submittedAt: order.submittedAt,
      /** What the pharmacy called it, once they accepted it. */
      externalOrderId: order.externalOrderId,
      externalRxNumber: order.externalRxNumber,
      lastError: order.lastError,
      /** Null until the first transmission attempt. */
      payload: order.requestPayload,
    };
  }

  async stuck() {
    const rows = await this.prisma.raw.pharmacyOrder.findMany({
      where: {
        status: { in: ['QUEUED', 'SUBMITTED'] },
        OR: [{ lastError: { not: null } }, { submittedAt: null }],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true, status: true, createdAt: true, attempts: true, lastError: true,
        submittedAt: true, externalOrderId: true,
        pharmacy: {
          select: {
            id: true, name: true,
            config: { select: { isEnabled: true, credentialCipher: true } },
          },
        },
        tenant: { select: { name: true } },
        prescription: {
          select: {
            signedAt: true,
            medication: { select: { name: true } },
            requestItem: { select: { kitCode: true } },
            patient: { select: { firstName: true, lastName: true, mrn: true } },
          },
        },
      },
    });

    const now = Date.now();

    return {
      data: rows.map((order) => {
        const configured = Boolean(order.pharmacy.config?.isEnabled && order.pharmacy.config.credentialCipher);
        return {
          id: order.id,
          status: order.status,
          pharmacy: { id: order.pharmacy.id, name: order.pharmacy.name },
          tenant: order.tenant.name,
          medication: order.prescription.medication.name,
          kitCode: order.prescription.requestItem?.kitCode ?? null,
          patient: `${order.prescription.patient.firstName} ${order.prescription.patient.lastName}`,
          mrn: order.prescription.patient.mrn,
          signedAt: order.prescription.signedAt.toISOString(),
          queuedAt: order.createdAt.toISOString(),
          /** How long a patient has been waiting on this, in hours. */
          waitingHours: Math.floor((now - order.createdAt.getTime()) / 3_600_000),
          attempts: order.attempts,
          lastError: order.lastError,
          // Says which of the two problems this is, because they need different
          // fixes: a broken connection, or no connection at all.
          reason: order.lastError
            ? 'transmission failed'
            : configured
              ? 'not sent yet'
              : `${order.pharmacy.name} has no working connection`,
        };
      }),
    };
  }
}
