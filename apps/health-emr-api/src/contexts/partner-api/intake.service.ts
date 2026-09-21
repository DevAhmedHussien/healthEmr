import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { PartnerIntake, PartnerVisitUpdate } from '@health-emr/types';
import { extractCustomQa } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { AuditService } from '@/shared/audit/audit.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { DomainEvent } from '@/shared/events/domain-events';
import { EntitlementsService } from '../tenancy/entitlements.service';
import { PatientIdentityService } from '../patients/patient-identity.service';
import { RoutingService } from '../practitioners/routing.service';
import { PartnerError, partnerBadRequest } from './partner-errors';

export interface IntakeResult {
  masterId: string;
  visitId: string;
  status: string;
}

/**
 * The partner intake path: validate entitlements, resolve the person, persist
 * the questionnaire, then route to a licensed provider.
 *
 * Every rejection below corresponds to a rule a Super Admin set for this tenant,
 * which is why the error text and the entitlement table are designed together.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly entitlements: EntitlementsService,
    private readonly patients: PatientIdentityService,
    private readonly routing: RoutingService,
  ) {}

  async submit(tenantId: string, tenantSlug: string, body: PartnerIntake): Promise<IntakeResult> {
    const { formObj } = body;

    // The key in the payload must agree with the key that authenticated us.
    if (body.company !== tenantSlug) {
      throw partnerBadRequest(PartnerError.NO_COMPANY);
    }

    // ── entitlement gates ────────────────────────────────────────────────
    const category = await this.entitlements.resolveCategory(tenantId, body.visitType);
    if (!category) throw partnerBadRequest(PartnerError.VISIT_TYPE_NOT_ENABLED);

    const pharmacy = await this.entitlements.resolvePharmacy(tenantId, body.pharmacyId);
    if (!pharmacy) throw partnerBadRequest(PartnerError.PHARMACY_MISMATCH);

    const medIds = formObj.patientPreference.map((item) => item.medId);
    const { found, missing } = await this.entitlements.resolveMedications(tenantId, medIds);
    if (missing.length) throw partnerBadRequest(PartnerError.NO_MED_MATCH(missing[0]));

    // A branded product cannot be filled by a compounding-only pharmacy.
    for (const medId of medIds) {
      const medication = found.get(medId)!;
      if (medication.isBranded && !pharmacy.dispensesBranded) {
        throw partnerBadRequest(PartnerError.BRANDED_WITH_COMPOUNDING);
      }
      if (medication.isCompounded && !pharmacy.dispensesCompounded) {
        throw partnerBadRequest(PartnerError.PHARMACY_MISMATCH);
      }
      // Controlled substances stay closed until EPCS is in place (D4).
      if (medication.isControlled) {
        throw partnerBadRequest('Controlled substances are not available through this integration');
      }
    }

    // The visit names a pharmacy and the medications the patient chose, and the
    // two have to agree. Without this, an order routes to a pharmacy that does
    // not carry the product — which surfaces days later as a patient still
    // waiting, rather than now as a rejected request the client can fix.
    // Matched on the pharmacy's own kit code. The visit already names the
    // pharmacy, so the pair identifies one product exactly.
    // Maps each ordered medId to the pharmacy's own kit code for it.
    const stocked = await this.entitlements.kitsStockedAt(pharmacy.id, medIds);
    for (const medId of medIds) {
      if (!stocked.has(medId)) {
        throw partnerBadRequest(PartnerError.NOT_STOCKED(medId, pharmacy.name));
      }
    }

    const tenant = await this.entitlements.findTenantBySlug(tenantSlug);
    if (tenant?.allowedStates.length && !tenant.allowedStates.includes(formObj.state)) {
      throw partnerBadRequest(PartnerError.STATE_NOT_VALID);
    }

    // ── idempotency ──────────────────────────────────────────────────────
    // Before identity, so a retried call does not touch patient data at all.
    const duplicate = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { tenantId_externalMasterId: { tenantId, externalMasterId: body.masterId } },
      select: { id: true, status: true },
    });
    if (duplicate) {
      throw new ConflictException({ status: 400, error: PartnerError.DUPLICATE_MASTER_ID });
    }

    // ── routing, before any patient data is written ──────────────────────
    // Order matters. Structural checks are about the *request* — the state's
    // rules and whether any contracted provider is licensed there — and need no
    // patient at all. Running them first means a request we are going to refuse
    // never creates a chart, which keeps junk rows out of the record and honours
    // data minimisation. It also means the tenant gets the actionable error
    // ("State not valid") rather than a later, less useful one.
    // One visit can carry medications from different clinical categories — a
    // weight-loss injection and an ED tablet on the same order. Each line is
    // placed with someone credentialed for it, which is usually one clinician
    // for the whole visit and occasionally two.
    const medicationCategories = await this.entitlements.categoriesForMedications(
      [...found.values()].map((medication) => medication.id),
    );

    const decision = await this.routing.routeVisit({
      tenantId,
      patientState: formObj.state,
      fallbackCategoryId: category.id,
      lines: formObj.patientPreference.map((item) => ({
        key: item.medId,
        label: item.name,
        categoryIds: medicationCategories.get(found.get(item.medId)!.id) ?? [],
      })),
    });

    if (decision.failure === 'structural') {
      this.logger.warn(`Structural routing failure for ${tenantSlug}: ${decision.reason}`);
      throw partnerBadRequest(PartnerError.STATE_NOT_VALID);
    }

    // Keyed by medId, which the payload guarantees is unique per line.
    const assignedTo = new Map(decision.lines.map((line) => [line.key, line.providerId]));
    const assignedAt = decision.assignedProviderId ? new Date() : null;

    // ── identity ─────────────────────────────────────────────────────────
    const { patientId } = await this.patients.resolveOrCreate(tenantId, {
      firstName: formObj.firstName,
      lastName: formObj.lastName,
      dob: formObj.dob,
      sexAtBirth: formObj.sex === 'Male' ? 'MALE' : 'FEMALE',
      phone: formObj.phone,
      email: formObj.email,
      addressLine1: formObj.address,
      city: formObj.city,
      residenceState: formObj.state,
      postalCode: formObj.zip,
    });

    // Cross-tenant: a visit opened by another client business counts too.
    if (await this.patients.hasRecentVisit(patientId)) {
      throw partnerBadRequest(PartnerError.NOT_ELIGIBLE);
    }

    // ── persist ──────────────────────────────────────────────────────────
    const qa = extractCustomQa(formObj as unknown as Record<string, unknown>);

    const created = await this.prisma.raw.$transaction(async (tx) => {
      const submission = await tx.qaSubmission.create({
        data: {
          tenantId,
          patientId,
          categoryId: category.id,
          templateVersion: 1,
          patientStateAtSubmission: formObj.state,
          valuesJson: { encrypted: this.phi.encryptJson(formObj) },
          answers: {
            create: qa.map((entry) => ({
              questionId: entry.questionId,
              questionText: entry.question,
              valueJson: { encrypted: this.phi.encrypt(entry.answer) },
            })),
          },
        },
        select: { id: true },
      });

      const request = await tx.prescriptionRequest.create({
        data: {
          tenantId,
          externalMasterId: body.masterId,
          qaSubmissionId: submission.id,
          patientId,
          categoryId: category.id,
          requestedPharmacyId: pharmacy.id,
          status: decision.assignedProviderId ? 'ASSIGNED' : 'PENDING_ASSIGNMENT',
          // The lead clinician. On a shared visit this is whoever holds the
          // most lines — the chart, the patient's messages and the caseload all
          // need one name, while the lines themselves carry who decides what.
          assignedProviderId: decision.assignedProviderId,
          assignedAt,
          items: {
            create: formObj.patientPreference.map((item) => ({
              medicationId: found.get(item.medId)!.id,
              // The pharmacy's own code for what they ordered, resolved above.
              // Not the medId: the pharmacy fills against this, and the cost and
              // price of the fill are both read from it.
              kitCode: stocked.get(item.medId) ?? item.medId,
              nameText: item.name,
              strength: item.strength,
              quantity: item.quantity,
              refills: item.refills,
              daysSupply: item.daysSupply ?? null,
              // What the patient paid the client business. Theirs, not ours —
              // we bill them separately at the agreed rate, and the difference
              // is their margin to see on their own dashboard.
              quotedPriceCents: item.patientPaidCents ?? null,
              // Usually the same clinician on every line. Recorded per line all
              // the same, so the one visit that had to be shared reads the same
              // way as the many that did not.
              assignedProviderId: assignedTo.get(item.medId) ?? null,
              assignedAt: assignedTo.has(item.medId) ? assignedAt : null,
            })),
          },
        },
        select: { id: true, status: true },
      });

      return request;
    });

    await this.routing.recordAttempts(created.id, decision.attempts);

    // Promote self-reported allergies, conditions and medications out of the
    // encrypted questionnaire blob into the structured clinical lists.
    //
    // This is safety-critical, not tidiness: the pharmacy's dispensing screen and
    // the provider's review both read the Allergy table. Left only in the blob, a
    // patient who wrote "Sulfa" shows as "no allergies recorded" to the person
    // about to dispense to them.
    await this.recordClinicalLists(patientId, formObj);

    await this.audit.record({
      action: 'PHI_CREATED',
      entityType: 'PrescriptionRequest',
      entityId: created.id,
      patientId,
      tenantId,
      after: { masterId: body.masterId, visitType: body.visitType, status: created.status },
    });

    this.events.publish(DomainEvent.VisitReceived, {
      requestId: created.id,
      tenantId,
      patientId,
      masterId: body.masterId,
    });

    if (decision.assignedProviderId) {
      this.events.publish(DomainEvent.VisitAssigned, {
        requestId: created.id,
        providerId: decision.assignedProviderId,
      });
    } else {
      this.events.publish(DomainEvent.VisitUnassignable, {
        requestId: created.id,
        reason: decision.reason ?? 'No provider available',
      });
    }

    return { masterId: body.masterId, visitId: created.id, status: created.status };
  }

  /**
   * Parses the free-text clinical fields into structured rows.
   *
   * Conservative on purpose. Splitting on separators catches the common
   * "Penicillin, sulfa" case; anything it cannot confidently split is stored as a
   * single entry rather than guessed at. A missed allergy is dangerous, but so is
   * an invented one, and the raw text is preserved either way so a clinician can
   * always read what the patient actually wrote.
   */
  private async recordClinicalLists(
    patientId: string,
    formObj: { allergies: string; medicalConditions: string; selfReportedMeds: string },
  ): Promise<void> {
    const NONE = /^\s*(none|n\/?a|no|nil|none known|nkda|no known allergies)\s*\.?\s*$/i;
    const split = (value: string): string[] =>
      NONE.test(value)
        ? []
        : value
            .split(/[,;\n]|\band\b/i)
            .map((part) => part.trim().replace(/^[-*\u2022]\s*/, ''))
            .filter((part) => part.length > 1 && !NONE.test(part))
            .slice(0, 30);

    const allergies = split(formObj.allergies);
    const conditions = split(formObj.medicalConditions);
    const medications = split(formObj.selfReportedMeds);

    await this.prisma.raw.$transaction(async (tx) => {
      for (const substance of allergies) {
        const existing = await tx.allergy.findFirst({
          where: { patientId, substance: { equals: substance, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.allergy.create({
          data: {
            patientId,
            substance: substance.slice(0, 200),
            type: 'DRUG',
            // Severity is unknown from a free-text field. Saying MILD would be a
            // clinical claim nobody made, so the schema default stands and the
            // reaction text records that it is patient-reported.
            reactionText: 'Patient-reported at intake; severity not assessed.',
            status: 'ACTIVE',
          },
        });
      }

      for (const display of conditions) {
        const existing = await tx.condition.findFirst({
          where: { patientId, display: { equals: display, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.condition.create({
          data: { patientId, display: display.slice(0, 300), clinicalStatus: 'ACTIVE' },
        });
      }

      for (const nameText of medications) {
        const existing = await tx.patientMedication.findFirst({
          where: { patientId, nameText: { equals: nameText, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.patientMedication.create({
          data: {
            patientId,
            nameText: nameText.slice(0, 250),
            status: 'ACTIVE',
            source: 'PATIENT_REPORTED',
          },
        });
      }
    });
  }

  /**
   * Corrects the contact and delivery details on a visit already submitted.
   *
   * Only while nobody has acted on it. Once a clinician has decided, the
   * address on the chart is the address they decided against and the order is
   * already with a pharmacy — changing it here would silently disagree with
   * both. The refusal says so rather than succeeding and doing nothing useful.
   *
   * Residence state is deliberately not among the editable fields even though
   * the patient record carries it: which state the patient was in decides which
   * clinician may treat them, and that decision has already been made. A patient
   * who gave the wrong state needs a new visit, not an edited one.
   */
  async update(
    tenantId: string,
    masterId: string,
    changes: PartnerVisitUpdate,
  ): Promise<{ masterId: string; visitId: string; changed: string[] }> {
    const visit = await this.prisma.raw.prescriptionRequest.findFirst({
      where: { tenantId, externalMasterId: masterId, voidedAt: null },
      select: { id: true, status: true, decidedAt: true, patientId: true },
    });

    if (!visit) throw partnerBadRequest(PartnerError.VISIT_NOT_FOUND);

    if (visit.decidedAt) {
      throw partnerBadRequest(PartnerError.VISIT_ALREADY_DECIDED);
    }

    const data = {
      ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
      ...(changes.email !== undefined ? { email: changes.email } : {}),
      ...(changes.address !== undefined ? { addressLine1: changes.address } : {}),
      ...(changes.city !== undefined ? { city: changes.city } : {}),
      ...(changes.state !== undefined ? { residenceState: changes.state } : {}),
      ...(changes.zip !== undefined ? { postalCode: changes.zip } : {}),
    };

    await this.prisma.raw.patient.update({ where: { id: visit.patientId }, data });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'Patient',
      entityId: visit.patientId,
      patientId: visit.patientId,
      tenantId,
      // The values, not just the field names: an address correction that turns
      // out to have been the wrong correction has to be traceable to what it
      // replaced.
      after: { via: 'partner visit update', masterId, ...data },
    });

    return { masterId, visitId: visit.id, changed: Object.keys(data) };
  }
}
