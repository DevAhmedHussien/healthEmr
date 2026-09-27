import { Injectable, Logger } from '@nestjs/common';
import {
  RESEND_WINDOW_DAYS,
  type CancelVisitInput,
  type ExternalStatus,
  type UpdateVisitInput,
} from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { DomainEvent } from '@/shared/events/domain-events';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { RoutingService } from '../practitioners/routing.service';

export interface ExternalResult {
  status: ExternalStatus;
  info: string;
  medsPrescribed?: Array<{
    rxName: string;
    rxStrength: string;
    rxRefills: string;
    rxQuantity: string;
    rxId: string;
    rxDirections: string;
    medId: string;
  }>;
}

const ok = (status: ExternalStatus, info: string): ExternalResult => ({ status, info });

/**
 * Updating a visit, and re-sending the prescription on it.
 *
 * One endpoint doing two jobs, because from the client's side it is one
 * question — "here is the corrected order" — and which job it turns into
 * depends on something the client cannot see: whether a clinician has looked at
 * the visit yet. Before a decision it is an amendment; after one it is a
 * resend.
 *
 * **On re-signing.** A resend does not ask a clinician again. It re-issues the
 * decision already made, which is only defensible because the guards below keep
 * the new prescription materially the same as the one that was approved: the
 * same dosage category, a pharmacy that stocks it, inside a week, and a limited
 * number of times. Take any of those away and this becomes a way to obtain a
 * prescription for something a clinician never assessed. They are checked in
 * the order the contract documents them, and each returns before the next runs.
 *
 * Every answer is HTTP 200 with a status string in the body. That is the
 * incumbent's convention, not one we would choose, and it is kept so a client
 * already handling these strings does not have to be rewritten.
 */
@Injectable()
export class ExternalVisitService {
  private readonly logger = new Logger(ExternalVisitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly entitlements: EntitlementsService,
    private readonly routing: RoutingService,
  ) {}

  async updateVisit(
    tenantId: string,
    body: UpdateVisitInput & { masterId: string },
  ): Promise<ExternalResult> {
    try {
      const visit = await this.findVisit(tenantId, body.masterId);
      if (!visit) return ok('NO_VISIT', `No visit found for masterId ${body.masterId}`);

      if (visit.referredAt) {
        return ok('VISIT_WAS_REFERRED', `The visit ${body.masterId} was referred by a doctor`);
      }

      const limit = visit.tenant.rxRetryLimit;
      if (visit.rxRetryCount >= limit) {
        return ok('TOO_MANY_RETRIES', `Rx retries limit reached for masterId ${body.masterId}`);
      }

      const medIds = body.patientPreference.map((line) => line.medId);

      // Entitlement first: a medId this account may not order is not a category
      // problem, and saying "category mismatch" would send an integrator
      // looking in the wrong place.
      const { found, missing } = await this.entitlements.resolveMedications(tenantId, medIds);
      if (missing.length) {
        return ok(
          'CATEGORY_MISMATCH',
          `Preference mismatch between original rx and ${missing.join(', ')}`,
        );
      }

      const medications = [...found.values()];

      const sameCategory = await this.prisma.raw.categoryMedication.findMany({
        where: {
          categoryId: visit.categoryId,
          medicationId: { in: medications.map((row) => row.id) },
        },
        select: { medicationId: true },
      });
      const inCategory = new Set(sameCategory.map((row) => row.medicationId));
      const strayIds = medications.filter((row) => !inCategory.has(row.id)).map((row) => row.medId);

      if (strayIds.length) {
        return ok(
          'CATEGORY_MISMATCH',
          `Preference mismatch between original rx and ${strayIds.join(', ')}`,
        );
      }

      const pharmacy = await this.entitlements.resolvePharmacy(tenantId, body.pharmacyId);
      if (!pharmacy) {
        return ok(
          'PHARMACY_MISMATCH',
          `Pharmacy mismatch between ${body.pharmacyId} and ${medIds.join(', ')}`,
        );
      }

      const stocked = await this.entitlements.kitsStockedAt(pharmacy.id, medIds);
      const unstocked = medIds.filter((medId) => !stocked.has(medId));
      if (unstocked.length) {
        return ok(
          'PHARMACY_MISMATCH',
          `Pharmacy mismatch between ${body.pharmacyId} and ${unstocked.join(', ')}`,
        );
      }

      // Undecided: this is an amendment, and no clinical window applies because
      // no clinical decision has been made.
      if (!visit.decidedAt) {
        await this.amend(visit, body, medications, pharmacy.id);
        return ok('VISIT_DATA_UPDATED', `Visit data updated for ${body.masterId}`);
      }

      const signedAt = visit.prescriptions[0]?.signedAt;
      if (!signedAt) {
        // Decided, but nothing was prescribed — a refusal. There is no
        // prescription to re-send, so the correction is an amendment and the
        // visit goes back for another look.
        await this.amend(visit, body, medications, pharmacy.id);
        return ok('VISIT_DATA_UPDATED', `Visit data updated for ${body.masterId}`);
      }

      const ageDays = (Date.now() - signedAt.getTime()) / 86_400_000;
      if (ageDays > RESEND_WINDOW_DAYS) {
        return ok('TOO_LONG_AGO', `Rx was sent too long ago for masterId ${body.masterId}`);
      }

      return await this.resend(visit, body, medications, pharmacy.id, stocked);
    } catch (error) {
      const caught = error as Error;
      this.logger.error(`updateVisit failed for ${body.masterId}`, caught.stack);
      return ok('GENERIC', `System error: ${caught.message}`);
    }
  }

  /**
   * Cancels a visit the client no longer wants filled.
   *
   * For the two cases a client actually hits: a clinician refused the
   * prescription, or the pharmacy rejected the order. In both the patient is
   * waiting on something that will never arrive, and the client wants it off
   * their books.
   *
   * A shipped visit is refused. The medication is in the post to a real
   * address, and a record saying it was cancelled would contradict the parcel.
   */
  async cancelVisit(
    tenantId: string,
    body: CancelVisitInput & { masterId: string },
  ): Promise<ExternalResult> {
    try {
      const visit = await this.findVisit(tenantId, body.masterId);
      if (!visit) return ok('NO_VISIT', `No visit found for masterId ${body.masterId}`);

      if (visit.status === 'CANCELLED') {
        return ok('VISIT_CANCELLED', `Visit ${body.masterId} was already cancelled`);
      }

      const orders = visit.prescriptions.flatMap((rx) => rx.orders);
      if (orders.some((order) => ['SHIPPED', 'DELIVERED'].includes(order.status))) {
        return ok(
          'ALREADY_SHIPPED',
          `The medication for ${body.masterId} has already shipped and cannot be cancelled`,
        );
      }

      await this.prisma.raw.$transaction(async (tx) => {
        await tx.prescriptionRequest.update({
          where: { id: visit.id },
          data: {
            status: 'CANCELLED',
            denialReason: body.reason,
            decidedAt: visit.decidedAt ?? new Date(),
          },
        });

        // Anything a pharmacy might still pick up has to stop.
        await tx.pharmacyOrder.updateMany({
          where: {
            prescriptionId: { in: visit.prescriptions.map((rx) => rx.id) },
            status: { in: ['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT'] },
          },
          data: { status: 'CANCELLED' },
        });

        // A prescription on a cancelled visit must not stay dispensable.
        await tx.prescription.updateMany({
          where: { requestId: visit.id, status: { notIn: ['SHIPPED', 'DELIVERED', 'VOIDED'] } },
          data: { status: 'VOIDED' },
        });
      });

      await this.audit.record({
        action: 'REQUEST_DECIDED',
        entityType: 'PrescriptionRequest',
        entityId: visit.id,
        patientId: visit.patientId,
        tenantId,
        tenantSlug: visit.tenant.slug,
        before: { status: visit.status },
        after: { status: 'CANCELLED', reason: body.reason, via: 'visits/{masterId}/cancel' },
      });

      return ok('VISIT_CANCELLED', `Visit ${body.masterId} cancelled`);
    } catch (error) {
      const caught = error as Error;
      this.logger.error(`cancelVisit failed for ${body.masterId}`, caught.stack);
      return ok('GENERIC', `System error: ${caught.message}`);
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private findVisit(tenantId: string, masterId: string) {
    return this.prisma.raw.prescriptionRequest.findFirst({
      where: { tenantId, externalMasterId: masterId, voidedAt: null },
      include: {
        tenant: { select: { slug: true, rxRetryLimit: true } },
        items: true,
        // Where the patient was at submission. An amended order has to be
        // re-routed, and a clinician practises medicine where the patient is.
        submission: { select: { patientStateAtSubmission: true } },
        prescriptions: {
          orderBy: { signedAt: 'desc' },
          include: { orders: { select: { id: true, status: true } } },
        },
      },
    });
  }

  /**
   * Replaces the requested lines on a visit nobody has acted on yet.
   *
   * Re-routed rather than left with whoever had it: the client may have swapped
   * a weight-loss product for an ED one, and the clinician who was going to
   * review the old order is not necessarily credentialed for the new one.
   */
  private async amend(
    visit: { id: string; tenantId: string; categoryId: string; submission: { patientStateAtSubmission: string } },
    body: UpdateVisitInput,
    medications: Array<{ id: string; medId: string }>,
    pharmacyId: string,
  ) {
    const byMedId = new Map(medications.map((row) => [row.medId, row.id]));

    const categories = await this.entitlements.categoriesForMedications([...byMedId.values()]);
    const decision = await this.routing.routeVisit({
      tenantId: visit.tenantId,
      patientState: visit.submission.patientStateAtSubmission,
      fallbackCategoryId: visit.categoryId,
      lines: body.patientPreference.map((line) => ({
        key: line.medId,
        label: line.name,
        categoryIds: categories.get(byMedId.get(line.medId)!) ?? [],
      })),
    });

    const assignedTo = new Map(decision.lines.map((line) => [line.key, line.providerId]));
    const assignedAt = decision.assignedProviderId ? new Date() : null;

    await this.prisma.raw.$transaction(async (tx) => {
      // Replaced wholesale rather than merged. The client sent the order it
      // wants, not a patch, and merging would leave a line it deliberately
      // dropped still on the visit.
      await tx.prescriptionRequestItem.deleteMany({ where: { requestId: visit.id } });

      await tx.prescriptionRequestItem.createMany({
        data: body.patientPreference.map((line) => ({
          requestId: visit.id,
          medicationId: byMedId.get(line.medId)!,
          nameText: line.name,
          strength: line.strength,
          quantity: line.quantity,
          refills: line.refills,
          daysSupply: line.daysSupply,
          decision: 'PENDING' as const,
          assignedProviderId: assignedTo.get(line.medId) ?? null,
          assignedAt: assignedTo.has(line.medId) ? assignedAt : null,
        })),
      });

      await tx.prescriptionRequest.update({
        where: { id: visit.id },
        data: {
          requestedPharmacyId: pharmacyId,
          assignedProviderId: decision.assignedProviderId,
          assignedAt,
          // Back to the top of somebody's queue. A visit that was refused and
          // then corrected is new work, not a decision to be edited.
          status: decision.assignedProviderId ? 'ASSIGNED' : 'PENDING_ASSIGNMENT',
          decidedAt: null,
          denialReason: null,
        },
      });
    });

    await this.routing.recordAttempts(visit.id, decision.attempts);
  }

  /**
   * Re-issues the clinician's decision against the corrected order.
   *
   * The prescriber, licence and signing time are copied from the prescription
   * being replaced, because that is whose decision this is — recording the
   * resend under anybody else would misattribute a clinical act. The old
   * prescription is voided so the chart does not show two live prescriptions
   * for one decision.
   */
  private async resend(
    visit: Awaited<ReturnType<ExternalVisitService['findVisit']>> & object,
    body: UpdateVisitInput,
    medications: Array<{ id: string; medId: string; name: string }>,
    pharmacyId: string,
    stocked: Map<string, string>,
  ): Promise<ExternalResult> {
    const original = visit.prescriptions[0];
    const byMedId = new Map(medications.map((row) => [row.medId, row]));
    const now = new Date();

    const created = await this.prisma.raw.$transaction(async (tx) => {
      await tx.prescription.updateMany({
        where: { requestId: visit.id, status: { notIn: ['SHIPPED', 'DELIVERED', 'VOIDED'] } },
        data: { status: 'VOIDED' },
      });

      const rows = [];
      for (const line of body.patientPreference) {
        const medication = byMedId.get(line.medId)!;

        const item = await tx.prescriptionRequestItem.create({
          data: {
            requestId: visit.id,
            medicationId: medication.id,
            kitCode: stocked.get(line.medId) ?? null,
            nameText: line.name,
            strength: line.strength,
            quantity: line.quantity,
            refills: line.refills,
            daysSupply: line.daysSupply,
            decision: 'APPROVED',
            // The decision being re-issued is the original prescriber's, so the
            // line stays theirs. Routing does not get a second say: nobody is
            // making a new clinical judgement here.
            assignedProviderId: original.providerId,
            assignedAt: original.signedAt,
          },
          select: { id: true },
        });

        const prescription = await tx.prescription.create({
          data: {
            tenantId: visit.tenantId,
            requestId: visit.id,
            requestItemId: item.id,
            patientId: visit.patientId,
            providerId: original.providerId,
            medicationId: medication.id,
            dose: line.strength,
            quantity: line.quantity,
            refills: Number.parseInt(line.refills, 10) || 0,
            daysSupply: Number.parseInt(line.daysSupply, 10) || null,
            sig: original.sig,
            signedAt: now,
            providerNameSnapshot: original.providerNameSnapshot,
            licenseNumberSnapshot: original.licenseNumberSnapshot,
            licenseStateSnapshot: original.licenseStateSnapshot,
            status: 'SIGNED',
          },
          select: { id: true, sig: true },
        });

        rows.push({
          rxName: line.name,
          rxStrength: line.strength,
          rxRefills: line.refills,
          rxQuantity: line.quantity,
          rxId: prescription.id,
          rxDirections: prescription.sig,
          medId: line.medId,
        });
      }

      await tx.prescriptionRequest.update({
        where: { id: visit.id },
        data: {
          requestedPharmacyId: pharmacyId,
          rxRetryCount: { increment: 1 },
          status: 'APPROVED',
        },
      });

      return rows;
    });

    await this.audit.record({
      action: 'PRESCRIPTION_SIGNED',
      entityType: 'PrescriptionRequest',
      entityId: visit.id,
      patientId: visit.patientId,
      tenantId: visit.tenantId,
      tenantSlug: visit.tenant.slug,
      before: { retry: visit.rxRetryCount },
      after: {
        retry: visit.rxRetryCount + 1,
        via: 'visits/{masterId}/outcome',
        // Whose decision this re-issues. The resend is attributed to them, so
        // the trail has to say the client triggered it and they did not.
        reIssuedFrom: original.id,
        prescriber: original.providerNameSnapshot,
        medIds: body.patientPreference.map((line) => line.medId),
      },
    });

    // Dispatch and the patient's message both hang off this, exactly as they do
    // for a first-time signature.
    for (const row of created) {
      // `requestId` is not optional to the subscribers: the webhook dispatcher
      // resolves the visit from it to find the masterId the client joins on.
      // Without it every RX_WRITTEN raised through this endpoint died in the
      // handler, and the client was never told the prescription was written.
      this.events.publish(DomainEvent.PrescriptionSigned, {
        prescriptionId: row.rxId,
        requestId: visit.id,
        patientId: visit.patientId,
      });
    }

    return {
      status: 'NEW_RX_SENT',
      info: `Successfully prescribed ${body.patientPreference.map((line) => line.medId).join(', ')}`,
      medsPrescribed: created,
    };
  }
}
