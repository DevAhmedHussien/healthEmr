import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { LifeFileService } from './lifefile/lifefile.service';
import { priceFill } from './pricing';

export interface RerouteResult {
  fromPharmacy: string;
  toPharmacy: string;
  newOrderId: string;
  transmitted: boolean;
  transmissionError: string | null;
  /** Set when the original pharmacy had already accepted the order. */
  warning: string | null;
}

/**
 * Moves a stuck order to a different pharmacy.
 *
 * An order stalls for reasons that have nothing to do with the prescription —
 * the pharmacy's API is down, they are out of stock, their credentials expired.
 * The patient is waiting either way, and the only fix that helps them is
 * sending it somewhere that can fill it.
 *
 * A reroute creates a *new* order at the new pharmacy and cancels the old one
 * rather than repointing the existing row. Where an order was first sent is part
 * of what happened, and a patient asking why their parcel is late deserves an
 * answer that still contains the first attempt.
 */
@Injectable()
export class RerouteService {
  private readonly logger = new Logger(RerouteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifefile: LifeFileService,
  ) {}

  /** Pharmacies that could take this order, with why each one can or cannot. */
  async candidatesFor(orderId: string) {
    const order = await this.prisma.raw.pharmacyOrder.findUnique({
      where: { id: orderId },
      include: {
        prescription: {
          include: {
            medication: { select: { isBranded: true, isCompounded: true } },
            requestItem: { select: { kitCode: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('That order does not exist');

    const kitCode = order.prescription.requestItem?.kitCode ?? null;
    const pharmacies = await this.prisma.raw.pharmacy.findMany({
      where: { id: { not: order.pharmacyId }, status: 'ACTIVE', isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, dispensesBranded: true, dispensesCompounded: true,
        statesServed: true,
        config: { select: { isEnabled: true, credentialCipher: true } },
        catalogProducts: kitCode
          ? { where: { kitCode, isActive: true }, select: { id: true, costOfGoodsCents: true } }
          : false,
      },
    });

    return pharmacies.map((pharmacy) => {
      const blockers: string[] = [];
      if (order.prescription.medication.isBranded && !pharmacy.dispensesBranded) {
        blockers.push('does not dispense branded products');
      }
      if (order.prescription.medication.isCompounded && !pharmacy.dispensesCompounded) {
        blockers.push('does not dispense compounded products');
      }
      if (kitCode && !(pharmacy.catalogProducts as unknown[] | undefined)?.length) {
        blockers.push(`does not stock ${kitCode}`);
      }

      return {
        id: pharmacy.id,
        name: pharmacy.name,
        statesServed: pharmacy.statesServed,
        // Not a blocker: an order can be moved to a pharmacy that works from the
        // fill queue rather than an API. It just will not transmit.
        transmits: Boolean(pharmacy.config?.isEnabled && pharmacy.config.credentialCipher),
        eligible: blockers.length === 0,
        blockers,
      };
    });
  }

  /**
   * Moves several prescriptions at once.
   *
   * Each is attempted independently and reported on: a batch where one
   * prescription has already shipped should move the other nine, not refuse the
   * lot. Returning what was skipped and why is the point — a silent partial
   * success is worse than a failure, because nobody goes looking for the rest.
   */
  async rerouteMany(
    prescriptionIds: string[],
    toPharmacyId: string,
    reason: string,
    actorUserId: string,
    force = false,
  ): Promise<{
    moved: Array<{ prescriptionId: string; toPharmacy: string; transmitted: boolean; warning: string | null }>;
    skipped: Array<{ prescriptionId: string; why: string }>;
  }> {
    const moved: Array<{ prescriptionId: string; toPharmacy: string; transmitted: boolean; warning: string | null }> = [];
    const skipped: Array<{ prescriptionId: string; why: string }> = [];

    for (const prescriptionId of prescriptionIds) {
      // The order that is actually live for this prescription. A prescription
      // rerouted before has a cancelled order and a current one; moving the
      // cancelled one again would be meaningless.
      const order = await this.prisma.raw.pharmacyOrder.findFirst({
        where: { prescriptionId, status: { notIn: ['CANCELLED', 'REJECTED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, pharmacyId: true, status: true },
      });

      if (!order) {
        skipped.push({ prescriptionId, why: 'has no active pharmacy order' });
        continue;
      }
      if (order.pharmacyId === toPharmacyId) {
        skipped.push({ prescriptionId, why: 'is already at that pharmacy' });
        continue;
      }

      try {
        const result = await this.reroute(order.id, toPharmacyId, reason, actorUserId, force);
        moved.push({
          prescriptionId,
          toPharmacy: result.toPharmacy,
          transmitted: result.transmitted,
          warning: result.warning,
        });
      } catch (error) {
        skipped.push({
          prescriptionId,
          why: error instanceof Error ? error.message : 'could not be moved',
        });
      }
    }

    return { moved, skipped };
  }

  async reroute(
    orderId: string,
    toPharmacyId: string,
    reason: string,
    actorUserId: string,
    force = false,
  ): Promise<RerouteResult> {
    const order = await this.prisma.raw.pharmacyOrder.findUnique({
      where: { id: orderId },
      include: {
        pharmacy: { select: { name: true } },
        prescription: {
          include: {
            medication: { select: { isBranded: true, isCompounded: true, name: true } },
            requestItem: { select: { kitCode: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('That order does not exist');

    /**
     * A shipped order is refused by default, because rerouting does not divert
     * a parcel — it cancels one order and raises another. The patient receives
     * a second box of a prescription medication.
     *
     * Sometimes that is the point: the first parcel was lost, damaged, or never
     * arrived, and the patient needs the medication they paid for. So the
     * refusal is a default rather than a wall, and `force` says the person
     * clicking understands they are dispatching a second parcel. The audit
     * entry records that the first had already shipped.
     */
    const alreadyOut = ['SHIPPED', 'DELIVERED'].includes(order.status);

    if (alreadyOut && !force) {
      throw new ConflictException(
        `That order has already ${order.status === 'SHIPPED' ? 'shipped' : 'been delivered'}. ` +
          'Rerouting it would send the patient a second parcel. Confirm that is intended to ' +
          'proceed.',
      );
    }

    const target = await this.prisma.raw.pharmacy.findUnique({
      where: { id: toPharmacyId },
      select: {
        id: true, name: true, status: true, isActive: true,
        dispensesBranded: true, dispensesCompounded: true,
      },
    });
    if (!target) throw new NotFoundException('That pharmacy does not exist');
    if (!target.isActive || target.status !== 'ACTIVE') {
      throw new BadRequestException(`${target.name} is not active`);
    }

    // The same capability rules that decide routing in the first place. A
    // reroute that ignores them just moves the stall somewhere else.
    if (order.prescription.medication.isBranded && !target.dispensesBranded) {
      throw new BadRequestException(`${target.name} does not dispense branded products`);
    }
    if (order.prescription.medication.isCompounded && !target.dispensesCompounded) {
      throw new BadRequestException(`${target.name} does not dispense compounded products`);
    }

    const kitCode = order.prescription.requestItem?.kitCode ?? null;
    // Re-priced against the pharmacy now filling it. The cost is theirs, and so
    // is their catalogue's price — but a rate negotiated with this client
    // survives the move, which is why the tenant goes into the lookup too.
    const pricing = await priceFill(this.prisma, {
      pharmacyId: toPharmacyId,
      tenantId: order.tenantId,
      kitCode,
      medicationId: order.prescription.medicationId,
    });

    if (kitCode && !pricing.productId) {
      throw new BadRequestException(
        `${target.name} does not stock ${kitCode}. Add it to their catalogue first, or choose ` +
          'a pharmacy that carries it.',
      );
    }

    const created = await this.prisma.raw.$transaction(async (tx) => {
      await tx.pharmacyOrder.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          lastError: `Rerouted to ${target.name}: ${reason}`,
        },
      });

      return tx.pharmacyOrder.create({
        data: {
          tenantId: order.tenantId,
          prescriptionId: order.prescriptionId,
          pharmacyId: toPharmacyId,
          status: 'QUEUED',
          // Priced against the new pharmacy: the cost of this fill is whatever
          // the pharmacy actually filling it charges us, and the margin has to
          // move with it.
          costOfGoodsCents: pricing.costOfGoodsCents,
          costSourceProductId: pricing.productId,
          sellPriceCents: pricing.sellPriceCents,
          sellPriceSource: pricing.sellPriceSource,
        },
        select: { id: true },
      });
    });

    await this.audit.record({
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'PharmacyOrder',
      entityId: orderId,
      tenantId: order.tenantId,
      actorUserId,
      before: { pharmacy: order.pharmacy.name, status: order.status },
      // Recorded on the entry itself, because "why are there two parcels" is
      // the question this answers a year later.
      after: {
        pharmacy: target.name,
        status: 'CANCELLED',
        reroutedTo: created.id,
        reason,
        ...(alreadyOut ? { secondParcelAfter: order.status } : {}),
      },
    });

    const result = await this.lifefile.transmit(created.id);

    return {
      fromPharmacy: order.pharmacy.name,
      toPharmacy: target.name,
      newOrderId: created.id,
      transmitted: result.ok,
      transmissionError: result.ok ? null : result.error,
      // The old pharmacy may already be picking and packing. We cannot cancel it
      // in their system from here, so say so rather than let two parcels ship.
      warning: order.externalOrderId
        ? `${order.pharmacy.name} had already accepted this as ${order.externalOrderId}. ` +
          'Contact them to cancel it, or the patient may receive two parcels.'
        : null,
    };
  }
}
