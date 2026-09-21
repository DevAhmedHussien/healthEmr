import { z } from 'zod';

/**
 * The provider's decision on a visit.
 *
 * A decision is made per line item, not per visit, because `patientPreference`
 * is an array: a provider may approve two medications and deny a third, and
 * each approved line becomes its own prescription.
 *
 * MODIFIED exists because approve-or-deny alone would make the provider a rubber
 * stamp on a patient's self-selection. Modifying requires a reason, and the
 * change is reported back to the tenant so they can reprice.
 */
export const ItemDecisionValue = {
  APPROVED: 'APPROVED',
  MODIFIED: 'MODIFIED',
  DENIED: 'DENIED',
} as const;
export type ItemDecisionValue = (typeof ItemDecisionValue)[keyof typeof ItemDecisionValue];

const quantityLike = z.string().trim().regex(/^\d+$/, 'Must be a whole number');

/** How a medication is administered. Mirrors the Prisma enum. */
export const ADMINISTRATION_ROUTES = [
  'SUBCUTANEOUS',
  'INTRAMUSCULAR',
  'ORAL',
  'SUBLINGUAL',
  'TOPICAL',
  'NASAL',
  'OTHER',
] as const;
export type AdministrationRoute = (typeof ADMINISTRATION_ROUTES)[number];

/** The verb each route takes, so composed directions read like English. */
const ROUTE_VERB: Record<AdministrationRoute, string> = {
  SUBCUTANEOUS: 'Inject',
  INTRAMUSCULAR: 'Inject',
  ORAL: 'Take',
  SUBLINGUAL: 'Dissolve',
  TOPICAL: 'Apply',
  NASAL: 'Spray',
  OTHER: 'Use',
};

/**
 * How the route reads, and how a site attaches to it.
 *
 * Kept as a pair because the two interact: "intramuscularly into the thigh"
 * works, "into the muscle into the thigh" does not. Where a site is given it
 * carries the location and the route word only states the depth.
 */
const ROUTE_PHRASE: Record<AdministrationRoute, string> = {
  SUBCUTANEOUS: 'subcutaneously',
  INTRAMUSCULAR: 'intramuscularly',
  ORAL: 'by mouth',
  SUBLINGUAL: 'under the tongue',
  // The site says where; a generic "to the skin" alongside it reads as a stutter.
  TOPICAL: '',
  NASAL: 'into the nostril',
  OTHER: '',
};

/** The preposition a site takes, per route. */
const SITE_PREPOSITION: Partial<Record<AdministrationRoute, string>> = {
  SUBCUTANEOUS: 'into the',
  INTRAMUSCULAR: 'into the',
  TOPICAL: 'to the',
};

/** Routes where "where on the body" is a real instruction rather than noise. */
export const ROUTES_NEEDING_SITE: readonly AdministrationRoute[] = [
  'SUBCUTANEOUS',
  'INTRAMUSCULAR',
  'TOPICAL',
];

export interface SigParts {
  dose: string;
  route?: AdministrationRoute;
  site?: string;
  frequency?: string;
  daysSupply?: number;
}

/**
 * Builds the directions from the parts a clinician filled in.
 *
 * One function, shared by the form that previews it and the server that stores
 * it, so what the clinician read before signing is exactly what was written. A
 * second implementation on either side is a prescription that says something
 * nobody approved.
 */
export function composeSig(parts: SigParts): string {
  const route = parts.route ?? 'OTHER';
  const site = parts.site?.trim();
  const preposition = SITE_PREPOSITION[route];

  const words = [
    ROUTE_VERB[route],
    parts.dose.trim(),
    ROUTE_PHRASE[route],
    site && preposition ? `${preposition} ${site}` : '',
    parts.frequency?.trim() ?? '',
    parts.daysSupply ? `for ${parts.daysSupply} days` : '',
  ];

  const sentence = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}

export const itemDecisionSchema = z
  .object({
    itemId: z.string().uuid('Unknown line item'),
    decision: z.enum(['APPROVED', 'MODIFIED', 'DENIED']),
    /**
     * Directions for use, as they print on the label.
     *
     * Composed from the structured fields below by `composeSig`, and still sent
     * so a clinician can adjust the wording before signing. Required whenever
     * anything is being dispensed.
     */
    sig: z.string().trim().min(3).max(500).optional(),
    /**
     * The amount given each time, e.g. "0.25mg".
     *
     * Not the same thing as `approvedStrength`, which is the product — a 2.5mg/mL
     * vial from which 0.25mg is drawn. Conflating them is how a tenfold dosing
     * error gets written down, so they are separate fields.
     */
    dose: z.string().trim().min(1).max(120).optional(),
    /** How it is given. Drives the verb in the directions. */
    route: z.enum(ADMINISTRATION_ROUTES).optional(),
    /** Where on the body, for anything injected or applied. */
    site: z.string().trim().max(200).optional(),
    /** How often, e.g. "once weekly". */
    frequency: z.string().trim().max(120).optional(),
    /**
     * The clinician's note to the patient, sent to them in chat.
     *
     * Separate from `reason`, which explains a change to the client business and
     * the record. This is written to be read by the person taking it.
     */
    patientNote: z.string().trim().max(2000).optional(),
    approvedStrength: z.string().trim().min(1).max(120).optional(),
    approvedQuantity: quantityLike.optional(),
    approvedRefills: quantityLike.optional(),
    daysSupply: quantityLike.optional(),
    /** Required for MODIFIED and DENIED — never an unexplained change. */
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const dispensing = value.decision !== 'DENIED';

    if (dispensing && !value.sig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sig'],
        message: 'Directions for use are required when approving a medication',
      });
    }

    if (dispensing && !value.dose) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dose'],
        message: 'Say how much to take each time',
      });
    }

    if (dispensing && !value.route) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['route'],
        message: 'Say how this is taken — a patient cannot infer it from the name',
      });
    }

    if (dispensing && !value.frequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['frequency'],
        message: 'Say how often to take it',
      });
    }

    // An injection with no site is the instruction most likely to be guessed at,
    // and guessing wrong is a real injury rather than a wasted dose.
    if (dispensing && value.route && ROUTES_NEEDING_SITE.includes(value.route) && !value.site) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['site'],
        message: 'Say where on the body — this is the part patients get wrong',
      });
    }

    if (value.decision !== 'APPROVED' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message:
          value.decision === 'DENIED'
            ? 'A denial must say why'
            : 'A change to what the patient requested must say why',
      });
    }

    if (value.decision === 'MODIFIED') {
      const changed =
        value.approvedStrength || value.approvedQuantity || value.approvedRefills;
      if (!changed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MODIFIED requires at least one changed field',
        });
      }
    }

    if (value.decision === 'DENIED' && (value.approvedQuantity || value.approvedRefills)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A denied line cannot carry approved quantities',
      });
    }
  });

export const decideRequestSchema = z
  .object({
    /** Every line on the visit must be decided — no partial reviews. */
    items: z.array(itemDecisionSchema).min(1, 'Decide at least one line item'),
    /** Optional summary note recorded on the visit. */
    note: z.string().trim().max(2000).optional(),
    /**
     * The patient needs to be seen elsewhere.
     *
     * Not a refusal. A refusal says "not this medication", and the client may
     * correct the request and send it back. A referral says "not online, and
     * not by me" — an in-person examination, a specialist, an emergency
     * department — and closes the visit to resubmission entirely, because the
     * answer was never about the medication that was asked for.
     *
     * Every line still has to be decided: a referred patient is owed a clear
     * answer on what they asked for, not a visit left open.
     */
    referral: z
      .object({
        reason: z
          .string()
          .trim()
          .min(10, 'Say where the patient should be seen and why')
          .max(1000),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ItemDecisionInput = z.infer<typeof itemDecisionSchema>;
export type DecideRequestInput = z.infer<typeof decideRequestSchema>;

/** Filters and pagination for the provider queue. */
export const providerQueueQuerySchema = z
  .object({
    status: z.enum(['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DENIED']).optional(),
    categorySlug: z.string().trim().max(120).optional(),
    /** Two-letter state the patient was in at submission. */
    state: z.string().trim().length(2).toUpperCase().optional(),
    /** Matches master ID, patient surname or MRN. */
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().max(500).optional(),
    /** `asc` puts the longest-waiting patient first, which is usually what you want. */
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export type ProviderQueueQuery = z.infer<typeof providerQueueQuerySchema>;
