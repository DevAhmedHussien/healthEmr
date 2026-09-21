import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DecideRequestInput } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { keysetWhere, toKeysetPage, type KeysetQuery } from '@/shared/http/pagination';
import { AuditService } from '@/shared/audit/audit.service';
import { PhiCryptoService } from '@/shared/crypto/phi-crypto.service';
import { ObjectStorageService } from '@/shared/storage/object-storage.service';
import { MessagingService } from '@/contexts/messaging/messaging.service';
import { EventBus } from '@/shared/events/event-bus.service';
import { DomainEvent } from '@/shared/events/domain-events';
import type { DomainEventEnvelope } from '@/shared/events/domain-events';
import { OnEvent } from '@nestjs/event-emitter';
import { runWithoutTenantScope } from '@/shared/auth/request-context';
import { EarningsService } from './earnings.service';

@Injectable()
export class PrescribingService {
  private readonly logger = new Logger(PrescribingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly earnings: EarningsService,
    private readonly phi: PhiCryptoService,
    private readonly storage: ObjectStorageService,
    private readonly messaging: MessagingService,
  ) {}

  /** Resolve the acting user to their provider profile. */
  async providerIdForUser(userId: string): Promise<string> {
    const profile = await this.prisma.raw.providerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new ForbiddenException('No provider profile for this account');
    return profile.id;
  }

  /**
   * The provider's own queue, oldest first by default — a patient who has been
   * waiting outranks one who just arrived.
   *
   * Keyset-paginated: a busy provider's queue grows without bound, and OFFSET
   * would degrade exactly when the queue is longest and speed matters most.
   */
  /**
   * Everything a clinician needs to decide one visit.
   *
   * The questionnaire is the point: a provider approving a prescription without
   * having read what the patient said is doing paperwork, not medicine. It is
   * decrypted here, alongside the allergies and conditions they reported, the
   * photographs they uploaded, and what they asked for.
   *
   * Scoped to the clinicians holding a line on it. Another clinician's visit is
   * not found rather than forbidden — whose caseload somebody is on is not
   * information to hand out either.
   *
   * A shared visit opens for both reviewers: each needs the whole chart — the
   * allergies, the questionnaire, the other medication under consideration — to
   * decide their own line safely.
   */
  async visit(providerId: string, visitId: string) {
    const visit = await this.prisma.raw.prescriptionRequest.findFirst({
      where: {
        // Withdrawn by the platform. Nothing left here to decide.
        voidedAt: null,
        id: visitId,
        items: { some: { assignedProviderId: providerId } },
      },
      include: {
        category: { select: { slug: true, name: true } },
        tenant: { select: { slug: true, name: true } },
        items: true,
        submission: {
          include: {
            answers: { orderBy: { questionId: 'asc' } },
            template: { select: { version: true, schemaJson: true } },
          },
        },
        patient: {
          include: {
            allergies: { where: { status: 'ACTIVE' } },
            conditions: { where: { clinicalStatus: 'ACTIVE' } },
            medications: { where: { status: 'ACTIVE' } },
            documents: {
              where: { kind: { in: ['ID_PHOTO', 'RX_PHOTO'] } },
              orderBy: { createdAt: 'desc' },
              select: { id: true, kind: true, mime: true, size: true, fileName: true, createdAt: true },
            },
          },
        },
      },
    });

    if (!visit) throw new NotFoundException('That visit is not on your queue');

    // The questionnaire arrives as Q/A pairs and is stored encrypted. Decrypted
    // here and nowhere else in this service.
    const answers = visit.submission.answers.map((answer) => ({
      questionId: answer.questionId,
      question: answer.questionText ?? '',
      answer: this.decodeAnswer(answer.valueJson),
    }));

    return {
      id: visit.id,
      masterId: visit.externalMasterId,
      status: visit.status,
      tenant: visit.tenant.name,
      category: { slug: visit.category.slug, name: visit.category.name },
      submittedAt: visit.submission.submittedAt.toISOString(),
      /** Where the patient was, which is what licensure follows. */
      patientState: visit.submission.patientStateAtSubmission,
      patient: {
        id: visit.patient.id,
        mrn: visit.patient.mrn,
        name: `${visit.patient.firstName} ${visit.patient.lastName}`,
        dob: this.phi.decrypt(visit.patient.dob),
        sexAtBirth: visit.patient.sexAtBirth,
        phone: visit.patient.phone,
        email: visit.patient.email,
        shipTo: [
          visit.patient.addressLine1,
          visit.patient.city,
          visit.patient.residenceState,
          visit.patient.postalCode,
        ]
          .filter(Boolean)
          .join(', '),
      },
      clinical: {
        allergies: visit.patient.allergies.map((row) => ({
          substance: row.substance,
          severity: row.severity,
          reaction: row.reactionText,
        })),
        conditions: visit.patient.conditions.map((row) => row.display),
        medications: visit.patient.medications.map((row) => [row.nameText, row.dose].filter(Boolean).join(' ')),
      },
      questionnaire: {
        version: visit.submission.templateVersion,
        answers,
      },
      /** Ids only. The bytes come from the document endpoint, one read at a time. */
      photos: visit.patient.documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        mime: document.mime,
        size: document.size,
        fileName: document.fileName,
        uploadedAt: document.createdAt.toISOString(),
      })),
      requested: visit.items.map((item) => ({
        id: item.id,
        name: item.nameText,
        strength: item.strength,
        quantity: item.quantity,
        refills: item.refills,
        daysSupply: item.daysSupply,
        kitCode: item.kitCode,
        decision: item.decision,
        decisionReason: item.decisionReason,
        /**
         * Whether this clinician is the one answering for this line.
         *
         * The whole chart is visible either way — deciding a medication safely
         * means seeing what else the patient was prescribed on the same visit —
         * but only their own lines are theirs to decide.
         */
        mine:
          item.assignedProviderId === providerId ||
          (item.assignedProviderId === null && visit.assignedProviderId === providerId),
      })),
      /** True when a colleague is reviewing the rest of this visit. */
      shared: new Set(visit.items.map((item) => item.assignedProviderId)).size > 1,
    };
  }

  /**
   * One photograph from a visit on this clinician's queue.
   *
   * Scoped through the visit, so a document id alone opens nothing — and
   * recorded, because looking at somebody's identification is a look at their
   * chart whatever the interface calls it.
   */
  async visitPhoto(providerId: string, visitId: string, documentId: string, actorUserId: string) {
    const visit = await this.prisma.raw.prescriptionRequest.findFirst({
      where: {
        // Withdrawn by the platform. Nothing left here to decide.
        voidedAt: null,
        id: visitId,
        items: { some: { assignedProviderId: providerId } },
      },
      select: { patientId: true },
    });
    if (!visit) throw new NotFoundException('That visit is not on your queue');

    const document = await this.prisma.raw.patientDocument.findFirst({
      where: { id: documentId, patientId: visit.patientId, kind: { in: ['ID_PHOTO', 'RX_PHOTO'] } },
      select: { bucket: true, objectKey: true, mime: true },
    });
    if (!document) throw new NotFoundException('Photo not found');

    await this.audit.record({
      action: 'PHI_READ',
      entityType: 'PatientDocument',
      entityId: documentId,
      patientId: visit.patientId,
      actorUserId,
      after: { visitId, reason: 'Provider viewed an uploaded photo' },
    });

    return { mime: document.mime, body: await this.storage.get(document.bucket, document.objectKey) };
  }

  /**
   * Renders one stored answer.
   *
   * Intake writes `{ encrypted: "phi.v1:…" }` — the ciphertext wrapped in an
   * object, because jsonb wants a document rather than a bare string. Anything
   * that will not decrypt is reported as such rather than shown as a blank: a
   * clinician seeing nothing next to "Are you pregnant?" would reasonably read
   * it as "no".
   */
  private decodeAnswer(value: unknown): string {
    const cipher =
      value && typeof value === 'object' && 'encrypted' in value
        ? (value as { encrypted: unknown }).encrypted
        : value;

    if (typeof cipher !== 'string') return String(cipher ?? '');

    try {
      return this.phi.decrypt(cipher);
    } catch {
      return '[could not be decrypted]';
    }
  }

  async queue(
    providerId: string,
    query: KeysetQuery & { status?: string; categorySlug?: string; state?: string; search?: string },
  ) {
    // Open work is the lines still waiting on *me*. On a visit two clinicians
    // share, mine leaves my queue once I have decided it, whether or not my
    // colleague has decided theirs; under a status filter the decisions view
    // wants everything I touched.
    const open = !query.status;

    const rows = await this.prisma.raw.prescriptionRequest.findMany({
      where: {
        // A withdrawn visit leaves the queue. Working one would be work nobody
        // asked for and nobody is paid for.
        voidedAt: null,
        items: {
          some: { assignedProviderId: providerId, ...(open ? { decision: 'PENDING' as const } : {}) },
        },
        status: query.status
          ? (query.status as never)
          : { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] },
        ...(query.categorySlug ? { category: { slug: query.categorySlug } } : {}),
        ...(query.state ? { submission: { patientStateAtSubmission: query.state } } : {}),
        ...(query.search
          ? {
              OR: [
                { externalMasterId: { contains: query.search, mode: 'insensitive' } },
                { patient: { lastName: { contains: query.search, mode: 'insensitive' } } },
                { patient: { mrn: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
        ...(keysetWhere(query.cursor, 'createdAt', query.order) ?? {}),
      },
      orderBy: [{ createdAt: query.order }, { id: query.order }],
      take: query.limit + 1,
      include: {
        category: { select: { slug: true, name: true } },
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        submission: { select: { patientStateAtSubmission: true, submittedAt: true } },
        items: {
          select: {
            id: true,
            nameText: true,
            strength: true,
            quantity: true,
            // Which way each line went, for the decisions view — a visit can be
            // half approved, and "APPROVED" on the visit alone hides that.
            decision: true,
            decisionReason: true,
            // Whose line it is. Almost always the one clinician; carried so the
            // rare shared visit can show who is answering for what.
            assignedProviderId: true,
          },
        },
        tenant: { select: { slug: true, name: true } },
      },
    });

    const page = toKeysetPage(rows, query.limit, 'createdAt');

    return {
      data: page.data.map((row) => ({
        id: row.id,
        visitId: row.id,
        masterId: row.externalMasterId,
        status: row.status,
        waitingSince: row.createdAt,
        /** Null while still open. The decisions view sorts and reads by it. */
        decidedAt: row.decidedAt,
        referredAt: row.referredAt,
        reason: row.denialReason,
        tenant: row.tenant.slug,
        category: row.category.slug,
        patient: {
          id: row.patient.id,
          mrn: row.patient.mrn,
          name: `${row.patient.firstName} ${row.patient.lastName}`,
          state: row.submission.patientStateAtSubmission,
        },
        items: row.items.map(({ assignedProviderId, ...item }) => ({
          ...item,
          /** False on a shared visit, for the lines a colleague is answering. */
          mine: assignedProviderId === providerId,
        })),
        /** True when another clinician is reviewing part of this visit. */
        shared: new Set(row.items.map((item) => item.assignedProviderId)).size > 1,
      })),
      pageInfo: page.pageInfo,
    };
  }

  /**
   * The clinician must be credentialed for everything they are about to sign.
   *
   * Checked here, at the signature, for the same reason the licence is: routing
   * decided who should see the visit, but a decision is only lawful if it was
   * valid at the moment it was made. Credentials can be withdrawn between
   * assignment and signing, and a visit can be corrected by the platform owner
   * after it was routed.
   *
   * A medication usually belongs to several categories (hair loss and its
   * follow-up, say), so holding *any one* of them is enough. Requiring all
   * would refuse a clinician who is plainly qualified.
   *
   * Denied lines are not checked: refusing to prescribe something is within
   * anybody's competence, and a clinician who spots a medication outside their
   * scope should be able to decline it rather than being unable to answer.
   */
  private async assertCredentialedFor(
    providerId: string,
    itemIds: string[],
    items: Array<{ id: string; medicationId: string; nameText: string }>,
  ): Promise<void> {
    const dispensing = items.filter((item) => itemIds.includes(item.id));
    if (!dispensing.length) return;

    // Two queries rather than one per line: a visit can carry several
    // medications and this sits on the signing path.
    const [held, medicationCategories] = await Promise.all([
      this.prisma.raw.providerCategory.findMany({
        where: { providerId },
        select: { categoryId: true },
      }),
      this.prisma.raw.categoryMedication.findMany({
        where: { medicationId: { in: dispensing.map((item) => item.medicationId) } },
        select: { medicationId: true, categoryId: true, category: { select: { name: true } } },
      }),
    ]);

    const holds = new Set(held.map((row) => row.categoryId));

    const unqualified = dispensing.filter((item) => {
      const belongsTo = medicationCategories.filter((row) => row.medicationId === item.medicationId);
      // A medication in no category at all is a catalogue fault, not a
      // credential one. Refusing here would strand the visit with nothing the
      // clinician could do about it, so it passes and the gap shows up in the
      // catalogue report instead.
      if (!belongsTo.length) return false;
      return !belongsTo.some((row) => holds.has(row.categoryId));
    });

    if (unqualified.length) {
      const needed = [
        ...new Set(
          medicationCategories
            .filter((row) => unqualified.some((item) => item.medicationId === row.medicationId))
            .map((row) => row.category.name),
        ),
      ];

      throw new ForbiddenException(
        `You are not credentialed to prescribe ${unqualified.map((item) => item.nameText).join(', ')}. ` +
          `That needs ${needed.join(' or ')}. Refuse the line, or ask for the visit to be reassigned.`,
      );
    }
  }

  /**
   * Records the provider's decision and signs whatever was approved.
   *
   * Everything happens in one transaction: a visit must never end up approved
   * with no prescription, or with prescriptions but an undecided line.
   */
  async decide(params: {
    requestId: string;
    providerId: string;
    actingUserId: string;
    input: DecideRequestInput;
  }) {
    const request = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: params.requestId },
      include: {
        items: true,
        submission: { select: { patientStateAtSubmission: true } },
      },
    });

    if (!request) throw new NotFoundException('Visit not found');

    const mine = linesFor(params.providerId, request);
    if (!mine.length) {
      throw new ForbiddenException('This visit is assigned to another provider');
    }

    if (!['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'].includes(request.status)) {
      throw new BadRequestException(`This visit is already ${request.status.toLowerCase()}`);
    }

    // Every line I am answering for must be decided. A half-reviewed visit is
    // not a decision — but on a shared visit "every line" means mine, not the
    // ones a colleague is credentialed for and I am not.
    const mineIds = new Set(mine.map((item) => item.id));
    const decidedIds = new Set(params.input.items.map((item) => item.itemId));

    const unknown = [...decidedIds].filter((id) => !mineIds.has(id));
    if (unknown.length) {
      const onTheVisit = request.items.some((item) => item.id === unknown[0]);
      throw onTheVisit
        ? new ForbiddenException('Another clinician is reviewing that medication')
        : new BadRequestException(`Line item does not belong to this visit: ${unknown[0]}`);
    }
    const undecided = [...mineIds].filter((id) => !decidedIds.has(id));
    if (undecided.length) {
      throw new BadRequestException(
        `Every line must be decided; ${undecided.length} still pending`,
      );
    }

    // Lines a colleague has already settled, needed below to tell a finished
    // visit from one still waiting on the other reviewer.
    const theirs = request.items.filter((item) => !mineIds.has(item.id));

    const dispensing = params.input.items.filter((item) => item.decision !== 'DENIED');

    // Re-check licensure at signing, not just at assignment. A licence can lapse
    // between the two, and the prescription is only lawful if it was valid at
    // the moment of signature.
    let licence: { licenseNumber: string; state: string } | null = null;
    let providerName = '';

    if (dispensing.length) {
      const profile = await this.prisma.raw.providerProfile.findUnique({
        where: { id: params.providerId },
        include: {
          user: { select: { firstName: true, lastName: true } },
          licenses: {
            where: {
              state: request.submission.patientStateAtSubmission,
              status: 'ACTIVE',
              expiresAt: { gt: new Date() },
            },
          },
        },
      });

      const active = profile?.licenses[0];
      if (!profile || !active) {
        throw new ForbiddenException(
          `You no longer hold an active licence in ${request.submission.patientStateAtSubmission}`,
        );
      }

      licence = { licenseNumber: active.licenseNumber, state: active.state };
      providerName = `${profile.user.firstName} ${profile.user.lastName}`;

      await this.assertCredentialedFor(
        params.providerId,
        dispensing.map((item) => item.itemId),
        request.items,
      );
    }

    const signedAt = new Date();

    const result = await this.prisma.raw.$transaction(async (tx) => {
      const createdPrescriptions: string[] = [];

      for (const decision of params.input.items) {
        const item = request.items.find((row) => row.id === decision.itemId)!;

        await tx.prescriptionRequestItem.update({
          where: { id: item.id },
          data: {
            decision: decision.decision,
            approvedStrength: decision.approvedStrength ?? null,
            approvedQuantity: decision.approvedQuantity ?? null,
            approvedRefills: decision.approvedRefills ?? null,
            decisionReason: decision.reason ?? null,
            decidedAt: signedAt,
          },
        });

        if (decision.decision === 'DENIED') continue;

        const prescription = await tx.prescription.create({
          data: {
            tenantId: request.tenantId,
            requestId: request.id,
            requestItemId: item.id,
            patientId: request.patientId,
            providerId: params.providerId,
            medicationId: item.medicationId,
            // What is given each time. Falls back to the product strength only
            // for a caller that sent no dose — the two are different numbers and
            // the fallback is a last resort, not the intent.
            dose: decision.dose ?? decision.approvedStrength ?? item.strength,
            quantity: decision.approvedQuantity ?? item.quantity,
            refills: Number(decision.approvedRefills ?? item.refills) || 0,
            daysSupply: decision.daysSupply
              ? Number(decision.daysSupply)
              : item.daysSupply
                ? Number(item.daysSupply)
                : null,
            // The sentence the clinician actually signed.
            //
            // The form composes it from the structured fields below and lets
            // them adjust the wording, so this is what was on screen at the
            // moment of signature — which is the thing a prescription is a
            // record of. The fields are stored alongside for the pharmacy and
            // the patient's app to act on, and everything the patient is shown
            // is built from this string rather than recomposed, so the label
            // and the message they receive cannot drift apart.
            sig: decision.sig!,
            route: decision.route ?? null,
            site: decision.site ?? null,
            frequency: decision.frequency ?? null,
            patientNote: decision.patientNote ?? null,
            // Frozen at signature: who signed, and under which licence.
            providerNameSnapshot: providerName,
            licenseNumberSnapshot: licence!.licenseNumber,
            licenseStateSnapshot: licence!.state,
            signedAt,
            status: 'SIGNED',
          },
          select: { id: true },
        });

        createdPrescriptions.push(prescription.id);
      }

      // What I decided, which is what I am paid on.
      const iApproved = dispensing.length > 0;

      // The visit itself only resolves when nothing is left pending on it. On a
      // shared visit the first clinician to finish leaves it open for the
      // second, so the patient gets one outcome rather than two partial ones.
      const stillOpen = theirs.some((item) => item.decision === 'PENDING');
      const anyApproved = iApproved || theirs.some((item) => item.decision !== 'DENIED');

      const referral = params.input.referral;

      await tx.prescriptionRequest.update({
        where: { id: request.id },
        data: {
          ...(stillOpen
            ? { status: 'IN_REVIEW' }
            : {
                status: anyApproved ? 'APPROVED' : 'DENIED',
                decidedAt: signedAt,
                denialReason: anyApproved
                  ? null
                  : (params.input.items.find((item) => item.reason)?.reason ??
                    theirs.find((item) => item.decisionReason)?.decisionReason ??
                    'Denied by provider'),
              }),
          // A referral closes the visit to resubmission. The client's
          // updateVisit call will be refused with VISIT_WAS_REFERRED rather
          // than quietly queueing a second opinion nobody asked for.
          ...(referral ? { referredAt: signedAt, referralReason: referral.reason } : {}),
        },
      });

      return { createdPrescriptions, iApproved, anyApproved, stillOpen };
    });

    // Recorded after the decision commits: the provider has done the work
    // whichever way it went. On a shared visit each reviewing clinician earns
    // for their own lines — two reviews is two pieces of clinical work, and
    // paying one fee between them would make the second review unpaid.
    await this.earnings.recordForReview({
      requestId: request.id,
      providerId: params.providerId,
      tenantId: request.tenantId,
      categoryId: request.categoryId,
      outcome: result.iApproved ? 'APPROVED' : 'DENIED',
      decidedAt: signedAt,
    });

    await this.audit.record({
      action: 'REQUEST_DECIDED',
      entityType: 'PrescriptionRequest',
      entityId: request.id,
      patientId: request.patientId,
      tenantId: request.tenantId,
      before: { status: request.status },
      after: {
        status: result.stillOpen ? 'IN_REVIEW' : result.anyApproved ? 'APPROVED' : 'DENIED',
        prescriptions: result.createdPrescriptions.length,
        // Named so the trail shows who decided what on a shared visit, rather
        // than two entries that look like one clinician changing their mind.
        lines: mine.map((item) => item.id),
        ...(result.stillOpen ? { awaitingOtherClinician: true } : {}),
      },
    });

    for (const prescriptionId of result.createdPrescriptions) {
      await this.audit.record({
        action: 'PRESCRIPTION_SIGNED',
        entityType: 'Prescription',
        entityId: prescriptionId,
        patientId: request.patientId,
        tenantId: request.tenantId,
        after: { signedAt, licenseState: licence?.state },
      });
      this.events.publish(DomainEvent.PrescriptionSigned, {
        prescriptionId,
        requestId: request.id,
        patientId: request.patientId,
      });
    }

    // The client hears one outcome per visit, when the visit is actually
    // finished. Announcing a half-decided visit would have them tell the patient
    // they were approved while a second medication is still under review.
    if (!result.stillOpen) {
      this.events.publish(
        result.anyApproved ? DomainEvent.VisitApproved : DomainEvent.VisitDenied,
        {
          requestId: request.id,
          masterId: request.externalMasterId,
          prescriptions: result.createdPrescriptions,
        },
      );
    }

    return {
      visitId: request.id,
      status: result.stillOpen ? 'IN_REVIEW' : result.anyApproved ? 'APPROVED' : 'DENIED',
      prescriptionIds: result.createdPrescriptions,
      /** True when a colleague still has lines to decide on this visit. */
      awaitingOtherClinician: result.stillOpen,
    };
  }

  /**
   * Asks the patient something before deciding.
   *
   * Sometimes the form does not answer the question a clinician actually has —
   * what the rash looks like now, whether they finished the last course, a
   * photograph of the injection site. Without this the only options are to
   * approve on an incomplete picture or refuse someone who would have answered
   * in a sentence, and both are worse for the patient.
   *
   * The question goes into the conversation they already have with this
   * clinician, not into a new channel. The patient is nudged by whatever they
   * have consented to — and that nudge carries no clinical detail, because a
   * text arrives on a lock screen anybody nearby can read.
   */
  async requestInformation(params: {
    requestId: string;
    providerId: string;
    actingUserId: string;
    question: string;
  }) {
    const request = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: params.requestId },
      select: {
        id: true,
        tenantId: true,
        patientId: true,
        status: true,
        externalMasterId: true,
        assignedProviderId: true,
        items: { select: { assignedProviderId: true } },
        patient: { select: { userId: true, firstName: true } },
      },
    });

    if (!request) throw new NotFoundException('Visit not found');
    if (!linesFor(params.providerId, request).length) {
      throw new ForbiddenException('This visit is assigned to another provider');
    }
    if (!['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'].includes(request.status)) {
      throw new BadRequestException(`This visit is already ${request.status.toLowerCase()}`);
    }
    if (!request.patient.userId) {
      throw new BadRequestException(
        'This patient has no portal login yet, so they cannot be asked anything. ' +
          'Send them an invitation first.',
      );
    }

    const profile = await this.prisma.raw.providerProfile.findUnique({
      where: { id: params.providerId },
      select: { userId: true },
    });
    if (!profile) throw new ForbiddenException('No provider profile');

    const threadId = await this.messaging.openPatientThread({
      tenantId: request.tenantId,
      patientId: request.patientId,
      patientUserId: request.patient.userId,
      providerUserId: profile.userId,
    });

    await this.messaging.postSystemMessage(threadId, params.question, {
      authorUserId: profile.userId,
      authorRole: 'PROVIDER',
    });

    // The visit leaves the working queue and waits. It is not refused and not
    // approved: a patient who answers in an hour should find their clinician
    // where they left them.
    await this.prisma.raw.prescriptionRequest.update({
      where: { id: request.id },
      data: { status: 'INFO_REQUESTED' },
    });

    await this.audit.record({
      action: 'REQUEST_DECIDED',
      entityType: 'PrescriptionRequest',
      entityId: request.id,
      patientId: request.patientId,
      tenantId: request.tenantId,
      actorUserId: params.actingUserId,
      before: { status: request.status },
      // The question itself is in the thread, encrypted. Recording it here too
      // would put clinical detail in a second place for no benefit.
      after: { status: 'INFO_REQUESTED', askedVia: 'patient thread' },
    });

    this.events.publish(DomainEvent.VisitInfoRequested, {
      requestId: request.id,
      masterId: request.externalMasterId,
      patientId: request.patientId,
      patientUserId: request.patient.userId,
      tenantId: request.tenantId,
      threadId,
    });

    return { visitId: request.id, status: 'INFO_REQUESTED', threadId };
  }

  /**
   * A patient answering brings their visit back to the clinician.
   *
   * Without this the clinician has to remember to go and look, and a visit put
   * on hold at 9am is still on hold at 6pm because the answer arrived while
   * they were with somebody else. Subscribed rather than called: messaging does
   * not know what a visit is, and should not have to.
   */
  @OnEvent(DomainEvent.ChatMessageSent)
  async onPatientReplied(
    envelope: DomainEventEnvelope<{ threadId: string; authorRole: string }>,
  ): Promise<void> {
    if (envelope.payload.authorRole !== 'PATIENT') return;

    try {
      await runWithoutTenantScope(async () => {
        const thread = await this.prisma.raw.chatThread.findUnique({
          where: { id: envelope.payload.threadId },
          select: { patientId: true },
        });
        if (!thread?.patientId) return;

        // Back to IN_REVIEW rather than ASSIGNED: the clinician had already
        // opened it, and sending it back to the top of the pile would lose
        // that.
        const { count } = await this.prisma.raw.prescriptionRequest.updateMany({
          where: { patientId: thread.patientId, status: 'INFO_REQUESTED', voidedAt: null },
          data: { status: 'IN_REVIEW' },
        });

        if (count) {
          this.logger.log(`Patient answered; ${count} visit(s) back on the queue`);
        }
      });
    } catch (error) {
      // A visit failing to come off hold is a delay, not a clinical error, and
      // must never fail the patient's message.
      this.logger.error('Could not return a visit to the queue', (error as Error).stack);
    }
  }

  async startReview(requestId: string, providerId: string) {
    const request = await this.prisma.raw.prescriptionRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        assignedProviderId: true,
        status: true,
        items: { select: { assignedProviderId: true } },
      },
    });

    if (!request) throw new NotFoundException('Visit not found');
    if (!linesFor(providerId, request).length) {
      throw new ForbiddenException('This visit is assigned to another provider');
    }
    if (request.status !== 'ASSIGNED') return { status: request.status };

    await this.prisma.raw.prescriptionRequest.update({
      where: { id: requestId },
      data: { status: 'IN_REVIEW', reviewStartedAt: new Date() },
    });

    return { status: 'IN_REVIEW' };
  }
}

/**
 * The lines a clinician is answering for on a visit.
 *
 * Normally all of them. A visit is only shared when no single clinician was
 * credentialed for every category on it, and then each line belongs to whoever
 * can review it. A line the router never placed falls to the clinician the
 * visit itself names, so it can always be decided by somebody.
 */
function linesFor<T extends { assignedProviderId: string | null }>(
  providerId: string,
  request: { assignedProviderId: string | null; items: T[] },
): T[] {
  return request.items.filter(
    (item) =>
      item.assignedProviderId === providerId ||
      (item.assignedProviderId === null && request.assignedProviderId === providerId),
  );
}
