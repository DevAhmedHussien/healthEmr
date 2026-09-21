import { z } from 'zod';
import { US_STATES } from './enums';
import { listQuerySchema } from './list-query';

/**
 * Public onboarding forms.
 *
 * These are the only schemas in the system reachable without authentication, so
 * they are the strictest: every field bounded, `.strict()` throughout, and no
 * field that could be mistaken for a privilege (no status, no ids, no role).
 */

const phone = z
  .string()
  .trim()
  .min(10, 'Enter a valid phone number')
  .max(40)
  .regex(/^[0-9+().\s-]+$/, 'Enter a valid phone number');

export const PHARMACY_DOCUMENT_KINDS = [
  'STATE_PHARMACY_LICENSE',
  'NONRESIDENT_PHARMACY_LICENSE',
  'DEA_REGISTRATION',
  'NCPDP_ASSIGNMENT',
  'NABP_VAWD_ACCREDITATION',
  'STERILE_COMPOUNDING_503A',
  'OUTSOURCING_FACILITY_503B',
  'FDA_REGISTRATION',
  'LIABILITY_INSURANCE',
  'BUSINESS_LICENSE',
  'W9',
  'CERTIFICATE_OF_ANALYSIS',
  'OTHER',
] as const;
export type PharmacyDocumentKindValue = (typeof PHARMACY_DOCUMENT_KINDS)[number];

export const PROVIDER_DOCUMENT_KINDS = [
  'STATE_MEDICAL_LICENSE',
  'DEA_REGISTRATION',
  'BOARD_CERTIFICATION',
  'MALPRACTICE_INSURANCE',
  'CURRICULUM_VITAE',
  'GOVERNMENT_ID',
  'NPI_CONFIRMATION',
  'OTHER',
] as const;
export type ProviderDocumentKindValue = (typeof PROVIDER_DOCUMENT_KINDS)[number];

/** Human labels for the landing-page upload list. */
export const PHARMACY_DOCUMENT_LABELS: Record<PharmacyDocumentKindValue, string> = {
  STATE_PHARMACY_LICENSE: 'State board of pharmacy licence',
  NONRESIDENT_PHARMACY_LICENSE: 'Non-resident pharmacy licence (per state you ship into)',
  DEA_REGISTRATION: 'DEA registration certificate',
  NCPDP_ASSIGNMENT: 'NCPDP provider ID assignment',
  NABP_VAWD_ACCREDITATION: 'NABP / VAWD accreditation',
  STERILE_COMPOUNDING_503A: '503A sterile compounding registration',
  OUTSOURCING_FACILITY_503B: '503B outsourcing facility registration',
  FDA_REGISTRATION: 'FDA establishment registration',
  LIABILITY_INSURANCE: 'Certificate of liability insurance',
  BUSINESS_LICENSE: 'Business licence / certificate of good standing',
  W9: 'IRS Form W-9',
  CERTIFICATE_OF_ANALYSIS: 'Certificate of analysis (sample product)',
  OTHER: 'Other supporting document',
};

export const PROVIDER_DOCUMENT_LABELS: Record<ProviderDocumentKindValue, string> = {
  STATE_MEDICAL_LICENSE: 'State medical licence (one per state)',
  DEA_REGISTRATION: 'DEA registration certificate',
  BOARD_CERTIFICATION: 'Board certification',
  MALPRACTICE_INSURANCE: 'Malpractice insurance certificate',
  CURRICULUM_VITAE: 'Curriculum vitae',
  GOVERNMENT_ID: 'Government-issued photo ID',
  NPI_CONFIRMATION: 'NPI confirmation letter',
  OTHER: 'Other supporting document',
};

/**
 * Documents an applicant must supply before review can conclude. Built from the
 * application rather than hardcoded, because a compounding pharmacy shipping
 * into eight states owes far more paperwork than a retail one shipping into its
 * own.
 */
export function requiredPharmacyDocuments(application: {
  dispensesCompounded: boolean;
  isOutsourcingFacility: boolean;
  statesServed: string[];
  homeState: string;
}): PharmacyDocumentKindValue[] {
  const required: PharmacyDocumentKindValue[] = [
    'STATE_PHARMACY_LICENSE',
    'BUSINESS_LICENSE',
    'LIABILITY_INSURANCE',
    'W9',
  ];

  const shipsElsewhere = application.statesServed.some((s) => s !== application.homeState);
  if (shipsElsewhere) required.push('NONRESIDENT_PHARMACY_LICENSE');
  if (application.dispensesCompounded) required.push('STERILE_COMPOUNDING_503A');
  if (application.isOutsourcingFacility) {
    required.push('OUTSOURCING_FACILITY_503B', 'FDA_REGISTRATION');
  }
  return required;
}

export function requiredProviderDocuments(): ProviderDocumentKindValue[] {
  return ['STATE_MEDICAL_LICENSE', 'MALPRACTICE_INSURANCE', 'GOVERNMENT_ID', 'CURRICULUM_VITAE'];
}

export const pharmacyApplicationSchema = z
  .object({
    legalName: z.string().trim().min(2, 'Legal name is required').max(250),
    tradingName: z.string().trim().max(250).optional(),
    contactName: z.string().trim().min(2, 'Contact name is required').max(200),
    contactEmail: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
    contactPhone: phone,
    websiteUrl: z.string().trim().url('Enter a valid URL').max(400).optional(),
    addressLine1: z.string().trim().min(1, 'Address is required').max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, 'City is required').max(120),
    state: z.enum(US_STATES, { errorMap: () => ({ message: 'Select a state' }) }),
    postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
    statesServed: z
      .array(z.enum(US_STATES))
      .min(1, 'Select at least one state you can ship into')
      .max(51),
    ncpdpId: z.string().trim().max(40).optional(),
    npi: z.string().trim().regex(/^\d{10}$/, 'NPI is 10 digits').optional(),
    deaNumber: z.string().trim().max(40).optional(),
    dispensesCompounded: z.boolean(),
    dispensesBranded: z.boolean(),
    isOutsourcingFacility: z.boolean().default(false),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.dispensesCompounded && !value.dispensesBranded) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispensesBranded'],
        message: 'Tell us whether you dispense compounded products, branded products, or both',
      });
    }
  });

export const providerApplicationSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
    phone,
    credentials: z.string().trim().min(2, 'Credentials are required').max(80),
    npi: z.string().trim().regex(/^\d{10}$/, 'NPI is 10 digits'),
    deaNumber: z.string().trim().max(40).optional(),
    specialties: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    yearsExperience: z.number().int().min(0).max(70).optional(),
    bio: z.string().trim().max(4000).optional(),
    requestedCategorySlugs: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    /**
     * The states this clinician can practise in. Routing depends entirely on
     * these, so each needs a licence number and an expiry — and each is checked
     * against an uploaded licence before approval.
     */
    licenses: z
      .array(
        z
          .object({
            state: z.enum(US_STATES),
            licenseNumber: z.string().trim().min(2, 'Licence number is required').max(80),
            issuedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            expiresAt: z
              .string()
              .trim()
              .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
          })
          .strict(),
      )
      .min(1, 'Add at least one state licence'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.licenses.forEach((licence, index) => {
      if (seen.has(licence.state)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['licenses', index, 'state'],
          message: `${licence.state} is listed more than once`,
        });
      }
      seen.add(licence.state);

      if (new Date(licence.expiresAt) <= new Date()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['licenses', index, 'expiresAt'],
          message: `The ${licence.state} licence has already expired`,
        });
      }
    });
  });

export type PharmacyApplicationInput = z.infer<typeof pharmacyApplicationSchema>;
export type ProviderApplicationInput = z.infer<typeof providerApplicationSchema>;

/**
 * The console's application filters, layered on the shared list-query contract.
 *
 * `pending` folds SUBMITTED and UNDER_REVIEW together, because that is the one
 * bucket a reviewer thinks in — while the underlying enum still records whether
 * somebody has picked it up.
 */
export const applicationStatusFilter = z.enum([
  'pending',
  'approved',
  'rejected',
  'needs_info',
]);

export const applicationFilterSchema = listQuerySchema
  .extend({
    status: applicationStatusFilter.optional(),
    state: z.enum(US_STATES).optional(),
    /** `YYYY-MM-DD..YYYY-MM-DD`, either side optional. */
    submitted: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/)
      .optional(),
    source: z.enum(['SELF_SERVE', 'SUPER_ADMIN']).optional(),
  })
  .strict();

/** Maps the reviewer's four buckets onto the stored enum. */
export const APPLICATION_STATUS_GROUPS = {
  pending: ['SUBMITTED', 'UNDER_REVIEW'],
  approved: ['APPROVED'],
  rejected: ['REJECTED', 'WITHDRAWN'],
  needs_info: ['INFO_REQUESTED'],
} as const;

export const PROVIDER_APPLICATION_SORT = ['createdAt', 'lastName', 'email', 'npi', 'status'] as const;
export const PHARMACY_APPLICATION_SORT = ['createdAt', 'legalName', 'contactEmail', 'state', 'status'] as const;

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(['UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED']),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.decision === 'REJECTED' || value.decision === 'INFO_REQUESTED') && !value.notes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'Tell the applicant what is wrong or what you need',
      });
    }
  });

export type ApplicationFilter = z.infer<typeof applicationFilterSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
