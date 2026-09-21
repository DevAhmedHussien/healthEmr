import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApplicationStatus, Prisma } from '@prisma/client';
import type {
  ApplicationFilter,
  PharmacyApplicationInput,
  ProviderApplicationInput,
  ReviewDecisionInput,
} from '@health-emr/types';
import {
  APPLICATION_STATUS_GROUPS,
  PHARMACY_APPLICATION_SORT,
  PROVIDER_APPLICATION_SORT,
  requiredPharmacyDocuments,
  requiredProviderDocuments,
} from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { ObjectStorageService } from '@/shared/storage/object-storage.service';
import { NotificationsService } from '@/contexts/notifications/notifications.service';
import { InviteService } from '@/contexts/identity/invite.service';
import { validateUpload } from '@/shared/storage/upload.validation';
import { runWithoutTenantScope } from '@/shared/auth/request-context';
import {
  buildOrderBy,
  listResponse,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';


/**
 * Filterable columns of the two application inboxes, keyed by the column id.
 *
 * `states`, `categories` and `documents` are list columns; a "contains" over an
 * array is a different question from a "contains" over text, and the panel
 * already offers a state picker that asks it properly.
 */
export const PROVIDER_APPLICATION_FILTERS = {
  lastName: { path: 'lastName', kind: 'text' },
  email: { path: 'email', kind: 'text' },
  npi: { path: 'npi', kind: 'text' },
  states: { path: 'licenses[].state', kind: 'text' },
  categories: { path: 'requestedCategorySlugs', kind: 'list' },
  documents: { path: 'documents', kind: 'presence' },
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

export const PHARMACY_APPLICATION_FILTERS = {
  legalName: { path: 'legalName', kind: 'text' },
  contactEmail: { path: 'contactEmail', kind: 'text' },
  integrationType: { path: 'integrationType', kind: 'exact', values: ['LIFEFILE', 'GENERIC_HTTP'] },
  statesServed: { path: 'statesServed', kind: 'list' },
  categorySlugs: { path: 'categorySlugs', kind: 'list' },
  documents: { path: 'documents', kind: 'presence' },
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorageService,
    private readonly notifications: NotificationsService,
    private readonly invites: InviteService,
  ) {}

  /** Where an applicant goes to claim the account we just made for them. */
  private inviteLink(token: string) {
    const base = process.env.AUTH_URL ?? 'http://localhost:3000';
    return `${base}/accept-invite?token=${token}`;
  }

  /**
   * Tells an applicant what happened.
   *
   * These go to a bare address — an applicant has no account, which is the point
   * of applying — so there is no authenticated surface to defer the content to.
   * They are therefore written to be safe in the clear: administrative facts
   * about an application, and never anything clinical.
   */
  private async emailDecision(params: {
    to: string;
    name: string;
    what: 'pharmacy' | 'provider';
    decision: string;
    notes?: string | null;
    inviteToken?: string;
  }) {
    const noun = params.what === 'pharmacy' ? 'pharmacy' : 'provider';

    if (params.decision === 'INFO_REQUESTED') {
      return this.notifications.notifyEmailAddress({
        to: params.to,
        kind: 'application.info_requested',
        subject: 'We need a little more for your HealthEMR application',
        body: [
          `Hello ${params.name},`,
          '',
          `We have reviewed your ${noun} application and need the following before we can continue:`,
          '',
          params.notes ?? 'Please get in touch for details.',
          '',
          'Reply to this email or use your original upload link to send it over.',
          '',
          'HealthEMR',
        ].join('\n'),
      });
    }

    if (params.decision === 'REJECTED') {
      return this.notifications.notifyEmailAddress({
        to: params.to,
        kind: 'application.rejected',
        subject: 'About your HealthEMR application',
        body: [
          `Hello ${params.name},`,
          '',
          `We are not able to move forward with your ${noun} application at this time.`,
          '',
          params.notes ?? '',
          '',
          'If circumstances change, you are welcome to apply again.',
          '',
          'HealthEMR',
        ].join('\n'),
      });
    }

    if (params.decision === 'APPROVED' && params.inviteToken) {
      return this.notifications.notifyEmailAddress({
        to: params.to,
        kind: 'application.approved',
        subject: `Your HealthEMR ${noun} account is ready`,
        body: [
          `Hello ${params.name},`,
          '',
          `Your ${noun} application has been approved and an account has been created for you.`,
          '',
          'Set your password here (the link is valid for 7 days and can be used once):',
          this.inviteLink(params.inviteToken),
          '',
          'We never set a password on your behalf, so this link is the only way in.',
          '',
          'HealthEMR',
        ].join('\n'),
      });
    }

    return { delivered: false };
  }

  // ── public submission ──────────────────────────────────────────────────

  /**
   * The treatment areas an applicant can say they cover.
   *
   * Follow-ups are excluded: "weight loss follow-up" is the same competence as
   * "weight loss", and listing both makes the applicant choose twice for one
   * skill — then wonder which one gates their queue.
   */
  async treatmentAreas() {
    return runWithoutTenantScope(() =>
      this.prisma.raw.category.findMany({
        where: { isActive: true, isFollowUp: false },
        orderBy: { sortOrder: 'asc' },
        select: { slug: true, name: true },
      }),
    );
  }

  async submitPharmacy(input: PharmacyApplicationInput, ip?: string | null) {
    // One open application per contact. Without this, a refresh-happy applicant
    // fills the review queue with duplicates of themselves.
    const open = await this.prisma.raw.pharmacyApplication.findFirst({
      where: {
        contactEmail: input.contactEmail.toLowerCase(),
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'] },
      },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException(
        'We already have an application in review for this email. We will be in touch.',
      );
    }

    const application = await this.prisma.raw.pharmacyApplication.create({
      data: {
        legalName: input.legalName,
        tradingName: input.tradingName ?? null,
        contactName: input.contactName,
        contactEmail: input.contactEmail.toLowerCase(),
        contactPhone: input.contactPhone,
        websiteUrl: input.websiteUrl ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        statesServed: input.statesServed,
        ncpdpId: input.ncpdpId ?? null,
        npi: input.npi ?? null,
        deaNumber: input.deaNumber ?? null,
        dispensesCompounded: input.dispensesCompounded,
        dispensesBranded: input.dispensesBranded,
        isOutsourcingFacility: input.isOutsourcingFacility,
        notes: input.notes ?? null,
        submittedIp: ip ?? null,
      },
      select: { id: true, createdAt: true },
    });

    await this.audit.record({
      action: 'TENANT_CREATED',
      entityType: 'PharmacyApplication',
      entityId: application.id,
      after: { legalName: input.legalName, statesServed: input.statesServed },
    });

    return {
      applicationId: application.id,
      submittedAt: application.createdAt,
      requiredDocuments: requiredPharmacyDocuments({
        dispensesCompounded: input.dispensesCompounded,
        isOutsourcingFacility: input.isOutsourcingFacility,
        statesServed: input.statesServed,
        homeState: input.state,
      }),
    };
  }

  async submitProvider(input: ProviderApplicationInput, ip?: string | null) {
    const open = await this.prisma.raw.providerApplication.findFirst({
      where: {
        email: input.email.toLowerCase(),
        status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'] },
      },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException(
        'We already have an application in review for this email. We will be in touch.',
      );
    }

    const application = await this.prisma.raw.providerApplication.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        credentials: input.credentials,
        npi: input.npi,
        deaNumber: input.deaNumber ?? null,
        specialties: input.specialties,
        yearsExperience: input.yearsExperience ?? null,
        bio: input.bio ?? null,
        requestedCategorySlugs: input.requestedCategorySlugs,
        submittedIp: ip ?? null,
        licenses: {
          create: input.licenses.map((licence) => ({
            state: licence.state,
            licenseNumber: licence.licenseNumber,
            issuedAt: licence.issuedAt ? new Date(licence.issuedAt) : null,
            expiresAt: new Date(licence.expiresAt),
          })),
        },
      },
      select: { id: true, createdAt: true },
    });

    await this.audit.record({
      action: 'USER_CREATED',
      entityType: 'ProviderApplication',
      entityId: application.id,
      after: { npi: input.npi, states: input.licenses.map((l) => l.state) },
    });

    return {
      applicationId: application.id,
      submittedAt: application.createdAt,
      requiredDocuments: requiredProviderDocuments(),
    };
  }

  // ── documents ──────────────────────────────────────────────────────────

  /**
   * Attaches a document to an application.
   *
   * Reachable without a session, because an applicant has no account yet — so
   * the id acts as a bearer capability. That is acceptable only because it is a
   * uuid4 (unguessable), the endpoint is rate limited, uploads are refused once
   * the application is decided, and a document can only ever be added, never
   * read back, through this route.
   */
  async attachPharmacyDocument(
    applicationId: string,
    input: {
      kind: string;
      state?: string;
      documentNumber?: string;
      issuedAt?: string;
      expiresAt?: string;
      /** Set when somebody on the platform uploads for the applicant. */
      uploadedByUserId?: string;
      uploadedNote?: string;
    },
    file: { originalname: string; buffer: Buffer; size: number },
  ) {
    const application = await this.prisma.raw.pharmacyApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true, legalName: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (!['SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'].includes(application.status)) {
      throw new BadRequestException('This application is closed and cannot take more documents');
    }

    const { mime } = validateUpload(file);
    const bucket = 'onboarding-documents';
    const objectKey = this.storage.buildKey(`pharmacy/${applicationId}`, file.originalname);
    const stored = await this.storage.put(bucket, objectKey, file.buffer, mime);

    const document = await this.prisma.raw.pharmacyApplicationDocument.create({
      data: {
        applicationId,
        kind: input.kind as never,
        state: input.state ?? null,
        documentNumber: input.documentNumber ?? null,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        fileName: file.originalname.slice(0, 255),
        mime: stored.mime,
        size: stored.size,
        uploadedByUserId: input.uploadedByUserId ?? null,
        uploadedNote: input.uploadedNote ?? null,
      },
      select: { id: true, kind: true, fileName: true, reviewStatus: true },
    });

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'PharmacyApplicationDocument',
      entityId: document.id,
      actorUserId: input.uploadedByUserId ?? null,
      after: {
        applicationId,
        kind: input.kind,
        fileName: document.fileName,
        onBehalf: Boolean(input.uploadedByUserId),
      },
    });

    return document;
  }

  async attachProviderDocument(
    applicationId: string,
    input: {
      kind: string;
      state?: string;
      documentNumber?: string;
      issuedAt?: string;
      expiresAt?: string;
      /** Set when somebody on the platform uploads for the applicant. */
      uploadedByUserId?: string;
      uploadedNote?: string;
    },
    file: { originalname: string; buffer: Buffer; size: number },
  ) {
    const application = await this.prisma.raw.providerApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (!['SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'].includes(application.status)) {
      throw new BadRequestException('This application is closed and cannot take more documents');
    }

    const { mime } = validateUpload(file);
    const bucket = 'onboarding-documents';
    const objectKey = this.storage.buildKey(`provider/${applicationId}`, file.originalname);
    const stored = await this.storage.put(bucket, objectKey, file.buffer, mime);

    return this.prisma.raw.providerApplicationDocument.create({
      data: {
        applicationId,
        kind: input.kind as never,
        state: input.state ?? null,
        documentNumber: input.documentNumber ?? null,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        fileName: file.originalname.slice(0, 255),
        mime: stored.mime,
        size: stored.size,
        uploadedByUserId: input.uploadedByUserId ?? null,
        uploadedNote: input.uploadedNote ?? null,
      },
      select: { id: true, kind: true, fileName: true, reviewStatus: true },
    });
  }

  /**
   * Trust a state licence without a document for it.
   *
   * The ordinary path is that a licence document is uploaded and accepted, and
   * accepting it verifies the licence. That breaks down in the real cases: the
   * clinician sent the certificate by fax, or the state board is checkable
   * online and there is no certificate to send at all. Without this, the
   * application simply cannot be approved and there is nothing on the screen
   * that says why not.
   *
   * The note is required and has a floor, because "verified" on its own is not
   * an audit trail. Routing treats this as proof a clinician may prescribe into
   * a state, so the record has to survive somebody asking, two years later, on
   * what basis.
   */
  async verifyLicence(
    applicationId: string,
    licenceId: string,
    reviewerId: string,
    note: string,
  ) {
    const licence = await this.prisma.raw.providerApplicationLicense.findUnique({
      where: { id: licenceId },
      select: { id: true, applicationId: true, state: true, licenseNumber: true, expiresAt: true },
    });
    if (!licence || licence.applicationId !== applicationId) {
      throw new NotFoundException('Licence not found on this application');
    }

    // An expired licence is not evidence of anything. Blocked rather than
    // warned: the whole point of verification is that routing may rely on it.
    if (licence.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        `That ${licence.state} licence expired on ${licence.expiresAt.toISOString().slice(0, 10)}. ` +
          'Ask for a current one rather than verifying this.',
      );
    }

    const updated = await this.prisma.raw.providerApplicationLicense.update({
      where: { id: licenceId },
      data: {
        verifiedAt: new Date(),
        verifiedMethod: 'MANUAL',
        verifiedByUserId: reviewerId,
        verifiedNote: note,
      },
      select: { id: true, state: true, verifiedAt: true, verifiedMethod: true, verifiedNote: true },
    });

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'ProviderApplicationLicense',
      entityId: licenceId,
      actorUserId: reviewerId,
      after: {
        state: licence.state,
        licenseNumber: licence.licenseNumber,
        verifiedMethod: 'MANUAL',
        note,
      },
    });

    return updated;
  }

  /** Undo a verification. Mistakes happen, and an unverified licence is safe. */
  async unverifyLicence(
    applicationId: string,
    licenceId: string,
    reviewerId: string,
    reason: string,
  ) {
    const licence = await this.prisma.raw.providerApplicationLicense.findUnique({
      where: { id: licenceId },
      select: { id: true, applicationId: true, state: true, verifiedMethod: true },
    });
    if (!licence || licence.applicationId !== applicationId) {
      throw new NotFoundException('Licence not found on this application');
    }

    const updated = await this.prisma.raw.providerApplicationLicense.update({
      where: { id: licenceId },
      data: { verifiedAt: null, verifiedMethod: null, verifiedByUserId: null, verifiedNote: null },
      select: { id: true, state: true, verifiedAt: true },
    });

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'ProviderApplicationLicense',
      entityId: licenceId,
      actorUserId: reviewerId,
      before: { state: licence.state, verifiedMethod: licence.verifiedMethod },
      after: { state: licence.state, verifiedMethod: null, reason },
    });

    return updated;
  }

  /** Super Admin accepts or rejects one document, and verifies the licence it proves. */
  async reviewDocument(
    scope: 'pharmacy' | 'provider',
    documentId: string,
    reviewerId: string,
    decision: 'ACCEPTED' | 'REJECTED',
    notes?: string,
  ) {
    if (scope === 'pharmacy') {
      const updated = await this.prisma.raw.pharmacyApplicationDocument.update({
        where: { id: documentId },
        data: { reviewStatus: decision, reviewNotes: notes ?? null },
        select: { id: true, kind: true, reviewStatus: true, applicationId: true },
      });
      await this.audit.record({
        action: 'ENTITLEMENT_CHANGED',
        entityType: 'PharmacyApplicationDocument',
        entityId: documentId,
        actorUserId: reviewerId,
        after: { reviewStatus: decision },
      });
      return updated;
    }

    const document = await this.prisma.raw.providerApplicationDocument.update({
      where: { id: documentId },
      data: { reviewStatus: decision, reviewNotes: notes ?? null },
      select: { id: true, kind: true, state: true, reviewStatus: true, applicationId: true },
    });

    // Accepting a state medical licence is what makes the claimed licence
    // trustworthy enough to gate routing, so mark it verified at the same moment.
    if (decision === 'ACCEPTED' && document.kind === 'STATE_MEDICAL_LICENSE' && document.state) {
      await this.prisma.raw.providerApplicationLicense.updateMany({
        where: { applicationId: document.applicationId, state: document.state },
        data: {
          verifiedAt: new Date(),
          verifiedMethod: 'DOCUMENT',
          verifiedByUserId: reviewerId,
        },
      });
    }

    await this.audit.record({
      action: 'ENTITLEMENT_CHANGED',
      entityType: 'ProviderApplicationDocument',
      entityId: documentId,
      actorUserId: reviewerId,
      after: { reviewStatus: decision, state: document.state },
    });

    return document;
  }

  async listDocuments(scope: 'pharmacy' | 'provider', applicationId: string) {
    return scope === 'pharmacy'
      ? this.prisma.raw.pharmacyApplicationDocument.findMany({
          where: { applicationId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, kind: true, state: true, fileName: true, mime: true, size: true,
            documentNumber: true, expiresAt: true, reviewStatus: true, reviewNotes: true,
            createdAt: true,
          },
        })
      : this.prisma.raw.providerApplicationDocument.findMany({
          where: { applicationId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, kind: true, state: true, fileName: true, mime: true, size: true,
            documentNumber: true, expiresAt: true, reviewStatus: true, reviewNotes: true,
            createdAt: true,
          },
        });
  }

  // ── review queue ───────────────────────────────────────────────────────

  async listPharmacyApplications(filter: ApplicationFilter) {
    const where: Prisma.PharmacyApplicationWhereInput = {
      ...(filter.status ? { status: { in: [...APPLICATION_STATUS_GROUPS[filter.status]] as never } } : {}),
      ...(filter.state ? { statesServed: { has: filter.state } } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...this.dateRange(filter.submitted),
      ...(searchAcross(filter.q, ['legalName', 'tradingName', 'contactEmail', 'contactPhone']) ?? {}),
      ...columnFilterWhere(filter, PHARMACY_APPLICATION_FILTERS),
    };

    const sort = safeSort(filter.sort, PHARMACY_APPLICATION_SORT, 'createdAt');

    // Three queries, run together: the page, its total, and the unfiltered total
    // that lets the UI say "no applications" rather than "no results".
    const [rows, total] = await Promise.all([
      this.prisma.raw.pharmacyApplication.findMany({
        where,
        orderBy: buildOrderBy(sort, filter.order),
        ...offsetSkipTake(filter),
        select: {
          id: true, legalName: true, tradingName: true, contactEmail: true, contactPhone: true,
          state: true, statesServed: true, categorySlugs: true, integrationType: true,
          dispensesCompounded: true, dispensesBranded: true, source: true,
          status: true, createdAt: true,
          _count: { select: { documents: true } },
        },
      }),
      this.prisma.raw.pharmacyApplication.count({ where }),
    ]);

    return listResponse(rows, total, filter, PHARMACY_APPLICATION_SORT);
  }

  async listProviderApplications(filter: ApplicationFilter) {
    const where: Prisma.ProviderApplicationWhereInput = {
      ...(filter.status ? { status: { in: [...APPLICATION_STATUS_GROUPS[filter.status]] as never } } : {}),
      ...(filter.state ? { licenses: { some: { state: filter.state } } } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...this.dateRange(filter.submitted),
      ...(searchAcross(filter.q, ['firstName', 'lastName', 'email', 'phone', 'npi']) ?? {}),
      ...columnFilterWhere(filter, PROVIDER_APPLICATION_FILTERS),
    };

    const sort = safeSort(filter.sort, PROVIDER_APPLICATION_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.providerApplication.findMany({
        where,
        orderBy: buildOrderBy(sort, filter.order),
        ...offsetSkipTake(filter),
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          credentials: true, npi: true, specialties: true, requestedCategorySlugs: true,
          source: true, status: true, createdAt: true,
          licenses: { select: { state: true, licenseNumber: true, expiresAt: true, verifiedAt: true } },
          _count: { select: { documents: true } },
        },
      }),
      this.prisma.raw.providerApplication.count({ where }),
    ]);

    return listResponse(rows, total, filter, PROVIDER_APPLICATION_SORT);
  }

  /**
   * Streams one uploaded document.
   *
   * These are driving licences, DEA certificates and photo IDs — identifying
   * documents belonging to real people. So the bytes are only ever served to an
   * authenticated caller, the object key comes from the database rather than the
   * URL (there is nothing for a caller to traverse with), and every read is
   * recorded.
   */
  async readDocument(scope: 'pharmacy' | 'provider', documentId: string) {
    const document =
      scope === 'pharmacy'
        ? await this.prisma.raw.pharmacyApplicationDocument.findUnique({ where: { id: documentId } })
        : await this.prisma.raw.providerApplicationDocument.findUnique({ where: { id: documentId } });

    if (!document) throw new NotFoundException('Document not found');

    const body = await this.storage.get(document.bucket, document.objectKey);

    await this.audit.record({
      action: 'PHI_READ',
      entityType: scope === 'pharmacy' ? 'PharmacyApplicationDocument' : 'ProviderApplicationDocument',
      entityId: documentId,
      after: { fileName: document.fileName, kind: document.kind },
    });

    return { body, mime: document.mime, fileName: document.fileName };
  }

  /** One application, with its licences and documents, for the review screen. */
  async getApplication(scope: 'pharmacy' | 'provider', id: string) {
    if (scope === 'pharmacy') {
      const row = await this.prisma.raw.pharmacyApplication.findUnique({
        where: { id },
        include: { documents: { orderBy: { createdAt: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Application not found');

      return {
        ...row,
        requiredDocuments: requiredPharmacyDocuments({
          dispensesCompounded: row.dispensesCompounded,
          isOutsourcingFacility: row.isOutsourcingFacility,
          statesServed: row.statesServed,
          homeState: row.state,
        }),
      };
    }

    const row = await this.prisma.raw.providerApplication.findUnique({
      where: { id },
      include: {
        licenses: { orderBy: { state: 'asc' } },
        documents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Application not found');

    return {
      ...row,
      requiredDocuments: requiredProviderDocuments(),
      /**
       * What actually stands between this application and approval.
       *
       * `requiredDocuments` lists document *kinds*, so one accepted licence
       * satisfies it however many states were claimed — while approval needs a
       * verified licence for every state. The two disagreeing is how a page
       * comes to read "0 still required" beside "approval is blocked", which
       * tells a reviewer there is nothing to do and is wrong.
       */
      outstanding: row.licenses
        .filter((licence) => !licence.verifiedAt)
        .map((licence) => ({
          licenceId: licence.id,
          state: licence.state,
          // Distinguishes "they never sent one" from "one is sitting here
          // waiting to be accepted" — different problems with different fixes.
          hasDocument: row.documents.some(
            (document) =>
              document.kind === 'STATE_MEDICAL_LICENSE' && document.state === licence.state,
          ),
        })),
    };
  }

  // ── review decisions ───────────────────────────────────────────────────

  /**
   * Approving a pharmacy provisions the real record. Until that moment an
   * applicant is only an applicant — nothing can be dispensed through them.
   */
  async decidePharmacy(applicationId: string, reviewerId: string, input: ReviewDecisionInput) {
    const application = await this.prisma.raw.pharmacyApplication.findUnique({
      where: { id: applicationId },
      include: { documents: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status === 'APPROVED') {
      throw new ConflictException('This application is already approved');
    }

    if (input.decision === 'APPROVED') {
      const required = requiredPharmacyDocuments({
        dispensesCompounded: application.dispensesCompounded,
        isOutsourcingFacility: application.isOutsourcingFacility,
        statesServed: application.statesServed,
        homeState: application.state,
      });

      const accepted = new Set(
        application.documents
          .filter((doc) => doc.reviewStatus === 'ACCEPTED')
          .map((doc) => doc.kind),
      );
      const missing = required.filter((kind) => !accepted.has(kind));

      if (missing.length) {
        throw new BadRequestException(
          `Cannot approve: these documents are not yet accepted — ${missing.join(', ')}`,
        );
      }
    }

    let pharmacyId: string | null = null;
    let inviteToken: string | undefined;

    if (input.decision === 'APPROVED') {
      pharmacyId = await this.provisionPharmacy(application);

      // Approving a pharmacy must also create someone who can sign in as it.
      // Without this an approved pharmacy has a record and no way to see its
      // own fill queue, which is how an order sits unnoticed.
      const { userId } = await this.invites.createLockedUser({
        email: application.contactEmail,
        role: 'PHARMACY',
        firstName: application.tradingName ?? application.legalName,
        lastName: 'Dispensary',
        phone: application.contactPhone,
        pharmacyId,
      });
      inviteToken = await this.invites.issue(userId, reviewerId);
    }

    const updated = await this.prisma.raw.pharmacyApplication.update({
      where: { id: applicationId },
      data: {
        status: input.decision as ApplicationStatus,
        reviewedByUserId: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
        ...(pharmacyId ? { pharmacyId } : {}),
      },
      select: { id: true, status: true, pharmacyId: true },
    });

    await this.audit.record({
      action: 'APPLICATION_DECIDED',
      entityType: 'PharmacyApplication',
      entityId: applicationId,
      actorUserId: reviewerId,
      before: { status: application.status },
      after: { status: updated.status, pharmacyId: updated.pharmacyId, notes: input.notes ?? null },
    });

    await this.emailDecision({
      to: application.contactEmail,
      name: application.contactName,
      what: 'pharmacy',
      decision: input.decision,
      notes: input.notes,
      inviteToken,
    });

    return updated;
  }

  async decideProvider(applicationId: string, reviewerId: string, input: ReviewDecisionInput) {
    const application = await this.prisma.raw.providerApplication.findUnique({
      where: { id: applicationId },
      include: { licenses: true, documents: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status === 'APPROVED') {
      throw new ConflictException('This application is already approved');
    }

    if (input.decision === 'APPROVED') {
      // Routing is only as trustworthy as these rows. Every claimed licence must
      // be backed by a document a human has accepted before it can gate traffic.
      const unverified = application.licenses.filter((licence) => !licence.verifiedAt);
      if (unverified.length) {
        throw new BadRequestException(
          `Cannot approve: unverified licences for ${unverified.map((l) => l.state).join(', ')}`,
        );
      }
    }

    let providerId: string | null = null;
    let inviteToken: string | undefined;

    if (input.decision === 'APPROVED') {
      providerId = await this.provisionProvider(application);

      const owner = await this.prisma.raw.providerProfile.findUniqueOrThrow({
        where: { id: providerId },
        select: { userId: true },
      });
      inviteToken = await this.invites.issue(owner.userId, reviewerId);
    }

    const updated = await this.prisma.raw.providerApplication.update({
      where: { id: applicationId },
      data: {
        status: input.decision as ApplicationStatus,
        reviewedByUserId: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
        ...(providerId ? { providerId } : {}),
      },
      select: { id: true, status: true, providerId: true },
    });

    await this.audit.record({
      action: 'APPLICATION_DECIDED',
      entityType: 'ProviderApplication',
      entityId: applicationId,
      actorUserId: reviewerId,
      before: { status: application.status },
      after: { status: updated.status, providerId: updated.providerId, notes: input.notes ?? null },
    });

    await this.emailDecision({
      to: application.email,
      name: `${application.firstName} ${application.lastName}`,
      what: 'provider',
      decision: input.decision,
      notes: input.notes,
      inviteToken,
    });

    return updated;
  }

  // ── provisioning ───────────────────────────────────────────────────────

  private async provisionPharmacy(application: {
    id: string;
    legalName: string;
    tradingName: string | null;
    ncpdpId: string | null;
    contactEmail: string;
    contactPhone: string;
    dispensesCompounded: boolean;
    dispensesBranded: boolean;
  }): Promise<string> {
    const base = (application.tradingName ?? application.legalName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);

    let slug = base;
    for (let attempt = 2; await this.slugTaken(slug); attempt += 1) {
      slug = `${base}-${attempt}`;
    }

    const pharmacy = await this.prisma.raw.pharmacy.create({
      data: {
        slug,
        name: application.tradingName ?? application.legalName,
        platform: 'GENERIC_HTTP',
        ncpdpId: application.ncpdpId,
        dispensesCompounded: application.dispensesCompounded,
        dispensesBranded: application.dispensesBranded,
        // FulfilmentService resolves a signed-in pharmacy user to their pharmacy
        // through this address, so it has to match the account we create.
        contactEmail: application.contactEmail,
        contactPhone: application.contactPhone,
        // Provisioned inactive: credentials and a config must be attached before
        // anything can be dispensed through them.
        isActive: false,
      },
      select: { id: true },
    });

    return pharmacy.id;
  }

  private async slugTaken(slug: string): Promise<boolean> {
    const existing = await this.prisma.raw.pharmacy.findUnique({ where: { slug }, select: { id: true } });
    return existing !== null;
  }

  private async provisionProvider(application: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    credentials: string;
    npi: string;
    deaNumber: string | null;
    specialties: string[];
    bio: string | null;
    requestedCategorySlugs: string[];
    licenses: Array<{ state: string; licenseNumber: string; issuedAt: Date | null; expiresAt: Date }>;
  }): Promise<string> {
    // Locked account, claimed by invite. Conflicts on an address already used at
    // another role are refused rather than silently reassigned.
    const { userId } = await this.invites.createLockedUser({
      email: application.email,
      role: 'PROVIDER',
      firstName: application.firstName,
      lastName: application.lastName,
      phone: application.phone,
    });

    return this.prisma.raw.$transaction(async (tx) => {
      const user = { id: userId };

      const profile = await tx.providerProfile.create({
        data: {
          userId: user.id,
          npi: application.npi,
          credentials: application.credentials,
          specialties: application.specialties,
          bio: application.bio,
          deaNumber: application.deaNumber,
          // Not accepting work until an admin turns them on.
          isAcceptingRequests: false,
          licenses: {
            create: application.licenses.map((licence) => ({
              state: licence.state,
              licenseNumber: licence.licenseNumber,
              issuedAt: licence.issuedAt,
              expiresAt: licence.expiresAt,
            })),
          },
        },
        select: { id: true },
      });

      if (application.requestedCategorySlugs.length) {
        const categories = await tx.category.findMany({
          where: { slug: { in: application.requestedCategorySlugs } },
          select: { id: true },
        });
        if (categories.length) {
          await tx.providerCategory.createMany({
            data: categories.map((category) => ({
              providerId: profile.id,
              categoryId: category.id,
            })),
            skipDuplicates: true,
          });
        }
      }

      return profile.id;
    });
  }

  /** `from..to`, either side optional. Returns {} so it can be spread freely. */
  private dateRange(range?: string) {
    if (!range) return {};
    const [from, to] = range.split('..');
    if (!from && !to) return {};
    return {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      },
    };
  }
}
