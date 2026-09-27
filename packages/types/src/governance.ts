import { z } from 'zod';
import { listQuerySchema } from './list-query';
import { ALL_PERMISSIONS, type PlatformPermission } from './roles';

/**
 * What the platform owner can read about its own operators, and what it may
 * change about the businesses, clinicians and pharmacies on the platform.
 *
 * The write side is deliberately narrow. Super Admin can change anything, but
 * "anything" here means a declared field on a declared record with a recorded
 * reason — not an open door onto the database. Every schema below exists so the
 * API can refuse a shape it was not designed to accept.
 */

// ── activity log ───────────────────────────────────────────────────────────

export const activityQuerySchema = listQuerySchema.extend({
  /** Who acted. */
  actorUserId: z.string().uuid().optional(),
  /** What they did. Free text so new AuditAction values need no type release. */
  action: z.string().trim().max(60).optional(),
  /** What they did it to. */
  entityType: z.string().trim().max(120).optional(),
  entityId: z.string().trim().max(120).optional(),
  /** Which client business the action belonged to. */
  tenantId: z.string().uuid().optional(),
  /** Only entries touching this patient — the HIPAA accounting-of-disclosures view. */
  patientId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export interface ActivityEntry {
  id: string;
  sequence: string;
  action: string;
  entityType: string;
  entityId: string | null;
  /** Rendered server-side: an operator reads "Suspended First Choice", not an enum. */
  summary: string;
  actor: { id: string; name: string; email: string; role: string } | null;
  tenant: { id: string; name: string } | null;
  patientId: string | null;
  /** Present only where the action changed something. */
  changes: Array<{ field: string; from: unknown; to: unknown }> | null;
  ip: string | null;
  requestId: string | null;
  at: string;
}

export interface ChainIntegrityReport {
  checked: number;
  intact: boolean;
  /** First position where the chain stops verifying, if any. */
  brokenAtSequence: string | null;
  reason: string | null;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
}

// ── write operations ───────────────────────────────────────────────────────

/**
 * Why a destructive or corrective change was made.
 *
 * Required, and required to be substantive. An audit trail of "reason: test"
 * tells a regulator nothing, so the minimum length is enforced rather than
 * suggested.
 */
export const reasonSchema = z
  .string()
  .trim()
  .min(10, 'Give a reason of at least 10 characters — this is written to the audit log')
  .max(500);

export const archiveSchema = z.object({ reason: reasonSchema });
export type ArchiveInput = z.infer<typeof archiveSchema>;

const usState = z.string().trim().length(2).toUpperCase();

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    contactEmail: z.string().trim().email().max(255).optional(),
    contactPhone: z.string().trim().max(40).nullable().optional(),
    ownerName: z.string().trim().max(200).nullable().optional(),
    billingPlan: z.string().trim().max(80).nullable().optional(),
    allowedStates: z.array(usState).max(60).optional(),
    reason: reasonSchema.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  });
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const updateProviderSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    credentials: z.string().trim().max(80).nullable().optional(),
    npi: z.string().trim().regex(/^\d{10}$/, 'An NPI is 10 digits').nullable().optional(),
    specialties: z.array(z.string().trim().max(80)).max(20).optional(),
    isAcceptingRequests: z.boolean().optional(),
    /** How many open visits this clinician may hold at once. */
    maxOpenRequests: z.number().int().min(0).max(500).optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    reason: reasonSchema.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  });
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const updatePharmacySchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    contactEmail: z.string().trim().email().max(255).nullable().optional(),
    contactPhone: z.string().trim().max(30).nullable().optional(),
    ncpdpId: z.string().trim().max(40).nullable().optional(),
    statesServed: z.array(usState).max(60).optional(),
    dispensesCompounded: z.boolean().optional(),
    dispensesBranded: z.boolean().optional(),
    isActive: z.boolean().optional(),
    reason: reasonSchema.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  });
export type UpdatePharmacyInput = z.infer<typeof updatePharmacySchema>;

/** Attaching or detaching a pharmacy or provider from a client business. */
export const rosterSchema = z.object({
  pharmacyId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  reason: reasonSchema.optional(),
});
export type RosterInput = z.infer<typeof rosterSchema>;

// ── billing ────────────────────────────────────────────────────────────────

export const invoiceQuerySchema = listQuerySchema.extend({
  tenantId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOID', 'REFUNDED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;

export const issueInvoiceSchema = z.object({
  dueInDays: z.number().int().min(0).max(180).default(30),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().min(1),
  processor: z.string().trim().min(2).max(60),
  externalId: z.string().trim().max(160).optional(),
  paidAt: z.coerce.date().optional(),
});

/** Which report to run. Each is a different question about the same ledger. */
export const REPORT_KINDS = ['cost-of-goods', 'revenue', 'provider-earnings', 'tenant-activity'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// ── reports ────────────────────────────────────────────────────────────────

export const reportQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface MoneyBreakdown {
  /** What the client business told us the item sells for. */
  revenueCents: number;
  /** What the dispensing pharmacy says the goods cost. */
  costOfGoodsCents: number;
  /** What we owe the clinicians who reviewed. */
  providerFeesCents: number;
  marginCents: number;
  /**
   * Share of prescriptions whose medication matched a priced pharmacy product.
   * Published with every cost figure — an estimate whose coverage is unstated
   * gets quoted as though it were exact.
   */
  costCoverage: number;
}

// ── pharmacy catalog ───────────────────────────────────────────────────────

export const pharmacyCategoryWriteSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
export type PharmacyCategoryWriteInput = z.infer<typeof pharmacyCategoryWriteSchema>;

export const pharmacyProductWriteSchema = z.object({
  pharmacyCategoryId: z.string().uuid(),
  kitCode: z.string().trim().min(1).max(160),
  favouriteName: z.string().trim().min(1).max(200),
  medicationName: z.string().trim().min(1).max(250),
  concentration: z.string().trim().max(120).nullable().optional(),
  form: z.enum(['INJECTABLE', 'ORAL', 'TOPICAL', 'NASAL', 'OTHER']).optional(),
  vialSize: z.string().trim().max(80).nullable().optional(),
  daysSupply: z.number().int().min(0).max(365).nullable().optional(),
  /** Integer cents. Money in a float is a rounding bug waiting to happen. */
  costOfGoodsCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  medicationId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type PharmacyProductWriteInput = z.infer<typeof pharmacyProductWriteSchema>;

export const pharmacyProductPatchSchema = pharmacyProductWriteSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Nothing to update' },
);
export type PharmacyProductPatchInput = z.infer<typeof pharmacyProductPatchSchema>;

/**
 * A clinician's licence in one state.
 *
 * States are not a tag on a provider the way they are on a pharmacy: routing
 * requires a licence that is ACTIVE and unexpired, so a state without a number
 * and an expiry date is not something the system can act on. Collecting all
 * three together is what stops a half-entered licence from silently failing to
 * route.
 */
export const providerLicenceInputSchema = z
  .object({
    state: z.string().trim().length(2).toUpperCase(),
    licenseNumber: z.string().trim().min(1).max(80),
    issuedAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime(),
  })
  .strict();

/** What Super Admin may change on an existing licence, including its standing. */
export const providerLicenceUpdateSchema = providerLicenceInputSchema
  .partial()
  .extend({
    status: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED']).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  });

export type ProviderLicenceInput = z.infer<typeof providerLicenceInputSchema>;
export type ProviderLicenceUpdate = z.infer<typeof providerLicenceUpdateSchema>;

// ── the owner's authority over super admins ────────────────────────────────

/**
 * Derived from the permission list, never retyped.
 *
 * Written out by hand this silently rejected every grant added afterwards: the
 * console offered the tickbox, the owner ticked it, and the request came back
 * 400 with the permission unchanged. A validator that has its own idea of what
 * exists is worse than no validator.
 */
const permission = z.enum(
  ALL_PERMISSIONS as unknown as [PlatformPermission, ...PlatformPermission[]],
);

/**
 * A new super admin.
 *
 * Permissions are chosen at creation rather than defaulted, so the person
 * adding an administrator has to decide what that administrator may do. An
 * empty list is allowed and means read-only, which is a reasonable starting
 * point for somebody new.
 */
export const createSuperAdminSchema = z
  .object({
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    permissions: z.array(permission).max(20).default([]),
  })
  .strict();

export const updateSuperAdminSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    permissions: z.array(permission).max(20).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'), {
    message: 'Nothing to change',
  });

/** Suspending or restoring an administrator, which is not the same as deleting. */
export const setSuperAdminActiveSchema = z
  .object({ isActive: z.boolean(), reason: z.string().trim().max(500).optional() })
  .strict();

/**
 * Removing one for good.
 *
 * The reason is required and long enough to be a sentence: this is the record
 * of why somebody with access to every patient no longer has it, and "cleanup"
 * answers nobody's question a year later.
 */
export const removeSuperAdminSchema = z
  .object({ reason: z.string().trim().min(10, 'Say why, in a sentence').max(500) })
  .strict();

export type CreateSuperAdminInput = z.infer<typeof createSuperAdminSchema>;
export type UpdateSuperAdminInput = z.infer<typeof updateSuperAdminSchema>;
