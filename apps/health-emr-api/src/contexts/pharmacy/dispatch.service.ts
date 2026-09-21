import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { priceFill } from './pricing';
import { LifeFileService } from './lifefile/lifefile.service';
import { DomainEvent, type DomainEventEnvelope } from '@/shared/events/domain-events';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

interface PrescriptionSignedPayload {
  prescriptionId: string;
  requestId: string;
  patientId: string;
}

/**
 * Turns a signed prescription into an order at a pharmacy.
 *
 * Driven by the domain event rather than called from the prescribing service:
 * signing is a clinical act and must not fail because a pharmacy integration is
 * down. The prescription is already valid and recorded; dispatch is a separate,
 * retryable step.
 *
 * The `PharmacyOrder` row in QUEUED is itself the work queue — no Redis, no SQS,
 * no second system to keep alive. A scheduled worker picks up whatever is still
 * QUEUED, which also means a crash mid-dispatch loses nothing.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifefile: LifeFileService,
  ) {}

  @OnEvent(DomainEvent.PrescriptionSigned)
  async onPrescriptionSigned(envelope: DomainEventEnvelope<PrescriptionSignedPayload>) {
    try {
      await this.queueOrder(envelope.payload.prescriptionId);
    } catch (error) {
      // Never let a dispatch failure surface as a failed signature.
      this.logger.error(
        `Failed to queue pharmacy order for prescription ${envelope.payload.prescriptionId}`,
        error as Error,
      );
    }
  }

  /**
   * Creates the order. Idempotent: a replayed event, or a retry after a partial
   * failure, must not produce two orders for one prescription.
   */
  async queueOrder(prescriptionId: string): Promise<string | null> {
    return runWithoutTenantScope(async () => {
      const existing = await this.prisma.raw.pharmacyOrder.findFirst({
        where: { prescriptionId },
        select: { id: true },
      });
      if (existing) return existing.id;

      const prescription = await this.prisma.raw.prescription.findUnique({
        where: { id: prescriptionId },
        include: {
          requestItem: { select: { kitCode: true } },
          request: { select: { requestedPharmacyId: true, tenantId: true } },
          medication: { select: { isBranded: true, isCompounded: true, name: true } },
        },
      });
      if (!prescription) return null;

      const pharmacyId = await this.choosePharmacy(prescription);
      if (!pharmacyId) {
        this.logger.warn(
          `No eligible pharmacy for prescription ${prescriptionId} (${prescription.medication.name})`,
        );
        return null;
      }

      // What this fill costs us and what it earns us, as of now. Snapshotted for
      // the same reason the prescribing licence is: a catalogue price edited in
      // June must not silently restate what March's margin was. Either figure
      // may be null when the catalogue has not been priced — reported as
      // uncovered rather than as zero, because a missing price and a free
      // product are not the same fact.
      //
      // This is also where revenue begins. An order only exists once a clinician
      // approved the line, so a refused request earns nothing by construction
      // rather than by someone remembering to exclude it later.
      const pricing = await priceFill(this.prisma, {
        pharmacyId,
        tenantId: prescription.tenantId,
        // The kit the client ordered, at the pharmacy filling it.
        kitCode: prescription.requestItem?.kitCode ?? null,
        medicationId: prescription.medicationId,
      });

      const order = await this.prisma.raw.pharmacyOrder.create({
        data: {
          tenantId: prescription.tenantId,
          prescriptionId,
          pharmacyId,
          status: 'QUEUED',
          costOfGoodsCents: pricing.costOfGoodsCents,
          costSourceProductId: pricing.productId,
          sellPriceCents: pricing.sellPriceCents,
          sellPriceSource: pricing.sellPriceSource,
        },
        select: { id: true },
      });

      await this.prisma.raw.prescription.update({
        where: { id: prescriptionId },
        data: { status: 'TRANSMITTED' },
      });

      await this.audit.record({
        action: 'ORDER_SUBMITTED',
        entityType: 'PharmacyOrder',
        entityId: order.id,
        patientId: prescription.patientId,
        tenantId: prescription.tenantId,
        after: { prescriptionId, pharmacyId, status: 'QUEUED' },
      });

      this.logger.log(`Queued pharmacy order ${order.id} for prescription ${prescriptionId}`);

      // Hand it to the pharmacy's own system. Deliberately after the order and
      // the prescription status are committed: a transmission failure must
      // leave a queued order somebody can retry, not lose the fact that the
      // prescription was signed.
      void this.lifefile
        .transmit(order.id)
        .catch((error) =>
          this.logger.error(`Transmitting order ${order.id} threw`, error as Error),
        );

      return order.id;
    });
  }

  /**
   * The pharmacy the tenant named on the visit, if it can actually dispense this
   * product; otherwise the tenant's default that can.
   *
   * Capability is re-checked here even though intake checked it, because the
   * medication can be changed by the provider between intake and signature — a
   * modification to a branded product would otherwise land at a
   * compounding-only pharmacy.
   */
  private async choosePharmacy(prescription: {
    tenantId: string;
    request: { requestedPharmacyId: string | null };
    medication: { isBranded: boolean; isCompounded: boolean };
  }): Promise<string | null> {
    const canDispense = (pharmacy: { dispensesBranded: boolean; dispensesCompounded: boolean; isActive: boolean }) =>
      pharmacy.isActive &&
      (!prescription.medication.isBranded || pharmacy.dispensesBranded) &&
      (!prescription.medication.isCompounded || pharmacy.dispensesCompounded);

    if (prescription.request.requestedPharmacyId) {
      const requested = await this.prisma.raw.pharmacy.findUnique({
        where: { id: prescription.request.requestedPharmacyId },
        select: { id: true, isActive: true, dispensesBranded: true, dispensesCompounded: true },
      });
      if (requested && canDispense(requested)) return requested.id;
    }

    const contracted = await this.prisma.raw.tenantPharmacy.findMany({
      where: { tenantId: prescription.tenantId },
      orderBy: { isDefault: 'desc' },
      include: {
        pharmacy: {
          select: { id: true, isActive: true, dispensesBranded: true, dispensesCompounded: true },
        },
      },
    });

    return contracted.find((link) => canDispense(link.pharmacy))?.pharmacy.id ?? null;
  }
}
