import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminVisitPatch, AuthenticatedUser } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { DomainEvent } from '@/shared/events/domain-events';
import { EntitlementsService } from '@/contexts/tenancy/entitlements.service';

/**
 * Withdrawing a visit at a client's request.
 *
 * A telehealth business asks for a visit to be removed — a test submission, a
 * duplicate, an order the patient disputed — and what they mean is "stop
 * counting it". So that is what this does: the visit disappears from every
 * list, every tile and every revenue and profit figure, for them and for us.
 *
 * What it does not do is delete the row, and that is deliberate rather than a
 * shortcut. A clinician may have read the chart; a pharmacy may already have
 * shipped a controlled substance to a real address. Erasing the record would
 * leave both of those events unexplained, and the audit trail is hash-chained
 * precisely so that history cannot be quietly rewritten. The visit is marked
 * withdrawn, by whom, when, and why — which is the answer an auditor needs and
 * the outcome the client asked for.
 *
 * Only a SUPER_ADMIN can do it. A client asking is not a client doing: the
 * whole point is that the party whose numbers change is not the party who
 * changes them.
 */
@Injectable()
export class VisitVoidService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly events: EventBus,
  ) {}

  async void(visitId: string, reason: string, actor: AuthenticatedUser, force = false) {
    const visit = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        externalMasterId: true,
        status: true,
        voidedAt: true,
        tenantId: true,
        tenant: { select: { slug: true, name: true } },
        patientId: true,
        providerEarnings: { select: { id: true, status: true, amountCents: true } },
        prescriptions: {
          select: { id: true, orders: { select: { id: true, status: true } } },
        },
      },
    });

    if (!visit) throw new NotFoundException('That visit does not exist');
    if (visit.voidedAt) throw new BadRequestException('That visit is already withdrawn');

    // A shipped order is a real parcel with a real medication in it, so the
    // default is to refuse: withdrawing it would leave the pharmacy's dispatch
    // and the patient's chart with nothing behind them.
    //
    // `force` exists because the platform owner sometimes has to anyway — a
    // duplicate, a test order that went out by mistake — and the alternative is
    // editing the database by hand, which leaves no trail at all. It is a
    // deliberate second step, and the audit entry below records that the
    // medication had shipped at the moment they took it.
    const shipped = visit.prescriptions
      .flatMap((prescription) => prescription.orders)
      .filter((order) => ['SHIPPED', 'DELIVERED'].includes(order.status));

    if (shipped.length && !force) {
      throw new BadRequestException(
        'This visit has already shipped. Raise a credit against the invoice instead — the ' +
          'medication reached the patient and the record has to say so. Send `force: true` with ' +
          'a reason if it has to be withdrawn anyway.',
      );
    }

    const voidedAt = new Date();

    await this.prisma.raw.$transaction(async (tx) => {
      await tx.prescriptionRequest.update({
        where: { id: visitId },
        data: { voidedAt, voidedReason: reason, voidedByUserId: actor.id },
      });

      // "Not count anything" includes what we owe the clinician for it. Fees are
      // voided rather than deleted for the same reason the visit is — and there
      // may be more than one, on a visit two clinicians shared.
      const payable = visit.providerEarnings.filter((earning) => earning.status !== 'VOID');
      if (payable.length) {
        await tx.providerEarning.updateMany({
          where: { id: { in: payable.map((earning) => earning.id) } },
          data: { status: 'VOID' },
        });
      }

      // An order still queued must not be filled now that the visit is gone.
      await tx.pharmacyOrder.updateMany({
        where: {
          prescriptionId: { in: visit.prescriptions.map((row) => row.id) },
          status: { in: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'] },
        },
        data: { status: 'CANCELLED' },
      });
    });

    await this.audit.record({
      action: 'PHI_DELETED',
      entityType: 'PrescriptionRequest',
      entityId: visitId,
      patientId: visit.patientId,
      tenantId: visit.tenantId,
      tenantSlug: visit.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before: { status: visit.status, voidedAt: null },
      after: {
        voidedAt: voidedAt.toISOString(),
        reason,
        providerFeeVoidedCents: totalCents(visit.providerEarnings),
        // The fact that matters most if anybody reads this back.
        ...(shipped.length ? { forcedAfterShipping: shipped.map((order) => order.status) } : {}),
      },
    });

    // Published rather than posted directly: a client's endpoint being slow
    // must not slow an operator withdrawing a visit.
    this.events.publish(DomainEvent.VisitVoided, { requestId: visitId, reason });

    return {
      id: visitId,
      masterId: visit.externalMasterId,
      voidedAt: voidedAt.toISOString(),
      reason,
      /** Named so the console can say what else changed, rather than implying nothing did. */
      alsoWithdrawn: {
        providerFeeCents: totalCents(visit.providerEarnings),
        ordersCancelled: visit.prescriptions.flatMap((row) => row.orders).length,
      },
      /** True when this overrode the shipped-medication guard. */
      forced: shipped.length > 0,
    };
  }

  /**
   * Corrects a visit, at any stage.
   *
   * Deliberately not bounded by whether a clinician has decided, unlike the
   * client's own update. The cases this exists for are the ones that arrive by
   * telephone after the fact — a patient who moved between ordering and
   * shipping, an order pointed at the wrong pharmacy, a status that has to
   * catch up with something that happened outside the system.
   *
   * The questionnaire is still untouchable. It is what the patient attested to,
   * and an answer that can be rewritten afterwards is not evidence of anything.
   */
  async patch(visitId: string, changes: AdminVisitPatch, actor: AuthenticatedUser) {
    const visit = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        status: true,
        patientId: true,
        tenantId: true,
        requestedPharmacyId: true,
        tenant: { select: { slug: true, name: true } },
        items: { select: { medication: { select: { medId: true } } } },
        patient: {
          select: {
            phone: true,
            email: true,
            addressLine1: true,
            city: true,
            residenceState: true,
            postalCode: true,
          },
        },
      },
    });

    if (!visit) throw new NotFoundException('That visit does not exist');

    const { reason, pharmacyId, status, ...contact } = changes;

    const patientData = {
      ...(contact.phone !== undefined ? { phone: contact.phone } : {}),
      ...(contact.email !== undefined ? { email: contact.email } : {}),
      ...(contact.address !== undefined ? { addressLine1: contact.address } : {}),
      ...(contact.city !== undefined ? { city: contact.city } : {}),
      ...(contact.state !== undefined ? { residenceState: contact.state } : {}),
      ...(contact.zip !== undefined ? { postalCode: contact.zip } : {}),
    };

    let pharmacy: { id: string; name: string } | null = null;
    if (pharmacyId) {
      // Resolved through entitlements, not by a raw lookup. A pharmacy this
      // client is not contracted to cannot fill their order, and pointing a
      // visit at one produces a stuck order the moment it is signed.
      const resolved = await this.entitlements.resolvePharmacy(visit.tenantId, pharmacyId);
      if (!resolved) {
        throw new BadRequestException(
          `${visit.tenant.name} is not contracted to a pharmacy called "${pharmacyId}"`,
        );
      }

      // And it has to actually stock what was asked for. Intake refuses this
      // on the way in; moving a visit afterwards has to hold the same line, or
      // the switch quietly creates the failure it was meant to avoid.
      const medIds = visit.items
        .map((item) => item.medication?.medId)
        .filter((medId): medId is string => Boolean(medId));

      if (medIds.length) {
        const stocked = await this.entitlements.kitsStockedAt(resolved.id, medIds);
        const missing = medIds.filter((medId) => !stocked.has(medId));

        if (missing.length) {
          throw new BadRequestException(
            `${resolved.name} does not stock ${missing.join(', ')}. Moving this visit there ` +
              'would leave it unfillable.',
          );
        }
      }

      pharmacy = { id: resolved.id, name: resolved.name };
    }

    await this.prisma.raw.$transaction(async (tx) => {
      if (Object.keys(patientData).length) {
        await tx.patient.update({ where: { id: visit.patientId }, data: patientData });
      }

      if (pharmacy || status) {
        await tx.prescriptionRequest.update({
          where: { id: visitId },
          data: {
            ...(pharmacy ? { requestedPharmacyId: pharmacy.id } : {}),
            ...(status ? { status } : {}),
          },
        });
      }
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'PrescriptionRequest',
      entityId: visitId,
      patientId: visit.patientId,
      tenantId: visit.tenantId,
      tenantSlug: visit.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      // The values on both sides, not just the field names. A correction that
      // turns out to have been the wrong correction has to be traceable to
      // what it replaced.
      before: {
        status: visit.status,
        pharmacyId: visit.requestedPharmacyId,
        ...visit.patient,
      },
      after: { reason, ...patientData, ...(pharmacy ? { pharmacy: pharmacy.name } : {}), ...(status ? { status } : {}) },
    });

    return {
      id: visitId,
      changed: [
        ...Object.keys(patientData),
        ...(pharmacy ? ['pharmacy'] : []),
        ...(status ? ['status'] : []),
      ],
    };
  }

  /** Puts a withdrawn visit back, if it was withdrawn in error. */
  async restore(visitId: string, actor: AuthenticatedUser) {
    const visit = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        voidedAt: true,
        voidedReason: true,
        tenantId: true,
        patientId: true,
        tenant: { select: { slug: true } },
      },
    });

    if (!visit) throw new NotFoundException('That visit does not exist');
    if (!visit.voidedAt) throw new BadRequestException('That visit is not withdrawn');

    await this.prisma.raw.prescriptionRequest.update({
      where: { id: visitId },
      data: { voidedAt: null, voidedReason: null, voidedByUserId: null },
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'PrescriptionRequest',
      entityId: visitId,
      patientId: visit.patientId,
      tenantId: visit.tenantId,
      tenantSlug: visit.tenant.slug,
      actorUserId: actor.id,
      actorRole: actor.role,
      before: { voidedAt: visit.voidedAt.toISOString(), reason: visit.voidedReason },
      after: { voidedAt: null },
    });

    // The provider fee and any cancelled order are not un-cancelled: whether the
    // clinician is paid again, and whether the pharmacy should fill after all,
    // are decisions a person makes, not consequences of undoing a click.
    return { id: visitId, restored: true };
  }
}

/** A visit shared between clinicians owes each of them, so fees add up. */
function totalCents(earnings: Array<{ status: string; amountCents: number }>): number {
  return earnings
    .filter((earning) => earning.status !== 'VOID')
    .reduce((sum, earning) => sum + earning.amountCents, 0);
}
