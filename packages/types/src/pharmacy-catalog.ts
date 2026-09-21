import { z } from 'zod';

/** Dosage form. Mirrors the Prisma `MedicationForm` enum. */
export const MEDICATION_FORMS = ['INJECTABLE', 'ORAL', 'TOPICAL', 'NASAL', 'OTHER'] as const;
export type MedicationFormValue = (typeof MEDICATION_FORMS)[number];

const slugish = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');

export const pharmacyCategoryInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    /** Derived from the name when omitted — see `toSlug`. */
    slug: slugish.optional(),
    description: z.string().trim().max(1000).optional(),
    /** Optional bridge to a clinical category (the partner API's visitType). */
    clinicalCategorySlug: z.string().trim().max(120).optional(),
    /**
     * Days a course in this category normally covers. Products inherit it
     * unless they state their own.
     */
    defaultDaysSupply: z.number().int().min(1).max(3650).nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const pharmacyCategoryUpdateSchema = pharmacyCategoryInputSchema.partial().strict();

export const pharmacyProductInputSchema = z
  .object({
    /** The code the pharmacy's own system expects on an order. */
    kitCode: z.string().trim().min(1, 'Kit ID is required').max(160),
    /** Internal shorthand our staff recognise. */
    favouriteName: z.string().trim().min(1, 'Favourite name is required').max(200),
    medicationName: z.string().trim().min(1, 'Medication name is required').max(250),
    concentration: z.string().trim().max(120).optional(),
    form: z.enum(MEDICATION_FORMS).default('OTHER'),
    vialSize: z.string().trim().max(80).optional(),
    daysSupply: z.number().int().min(1).max(3650).optional(),
    /**
     * Cost of goods in whole cents. Integer, never a float — money in a float is
     * a rounding bug with a delay fuse.
     */
    costOfGoodsCents: z.number().int().min(0).max(100_000_000).optional(),
    /**
     * What the platform charges a client business for this product, in whole
     * cents. Set by Super Admin, never by the pharmacy — the pharmacy states
     * what it costs, and the platform decides its own margin on top of that.
     */
    sellPriceCents: z.number().int().min(0).max(100_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const pharmacyProductUpdateSchema = pharmacyProductInputSchema.partial().strict();

/** What a pharmacy may set on its own catalogue: everything but our margin. */
export const dispensaryProductInputSchema = pharmacyProductInputSchema
  .omit({ sellPriceCents: true })
  .strict();

export const dispensaryProductUpdateSchema = dispensaryProductInputSchema.partial().strict();

export const pharmacyInputSchema = z
  .object({
    slug: slugish,
    name: z.string().trim().min(1).max(200),
    platform: z.enum(['LIFEFILE', 'GENERIC_HTTP']).default('GENERIC_HTTP'),
    ncpdpId: z.string().trim().max(40).optional(),
    dispensesCompounded: z.boolean().default(false),
    dispensesBranded: z.boolean().default(false),
    contactEmail: z.string().trim().email().optional(),
    contactPhone: z.string().trim().max(30).optional(),
    /** Where this pharmacy will ship. Empty means no stated restriction. */
    statesServed: z.array(z.string().trim().length(2).toUpperCase()).max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const pharmacyUpdateSchema = pharmacyInputSchema.partial().strict();

export type PharmacyCategoryInput = z.infer<typeof pharmacyCategoryInputSchema>;
export type PharmacyProductInput = z.infer<typeof pharmacyProductInputSchema>;
export type PharmacyInput = z.infer<typeof pharmacyInputSchema>;

/**
 * Turns a category name into its slug.
 *
 * Shared so the browser can show what the slug will be before saving and the
 * server can derive the same one, rather than the two drifting apart.
 */
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
}
