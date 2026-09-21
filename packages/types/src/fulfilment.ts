import { z } from 'zod';
import { listQuerySchema } from './list-query';

/** Carriers we accept a tracking number for. */
export const CARRIERS = ['FEDEX', 'UPS', 'USPS', 'DHL', 'COURIER', 'OTHER'] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Rough shape checks — enough to catch a typo, not to pretend we validated it. */
const TRACKING_PATTERNS: Partial<Record<Carrier, RegExp>> = {
  FEDEX: /^\d{12}(\d{3})?(\d{5})?$/,
  UPS: /^1Z[0-9A-Z]{16}$/i,
  USPS: /^(\d{20}|\d{22}|[A-Z]{2}\d{9}[A-Z]{2})$/i,
};

export const shipOrderSchema = z
  .object({
    carrier: z.enum(CARRIERS),
    trackingNumber: z.string().trim().min(4, 'Tracking number is required').max(120),
    shippedAt: z.string().trim().datetime({ offset: true }).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const pattern = TRACKING_PATTERNS[value.carrier];
    if (pattern && !pattern.test(value.trackingNumber.replace(/\s/g, ''))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trackingNumber'],
        message: `That does not look like a ${value.carrier} tracking number`,
      });
    }
  });

export const flagOrderIssueSchema = z
  .object({
    reason: z.enum([
      'OUT_OF_STOCK',
      'CLINICAL_CONCERN',
      'ADDRESS_PROBLEM',
      'PRESCRIPTION_UNCLEAR',
      'PATIENT_UNREACHABLE',
      'OTHER',
    ]),
    /** Goes to Super Admin. Free text, so it may contain PHI — it stays in-app. */
    message: z.string().trim().min(5, 'Say what the problem is').max(2000),
  })
  .strict();

export const pharmacyQueueQuerySchema = z
  .object({
    status: z
      .enum(['QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT', 'SHIPPED', 'DELIVERED', 'REJECTED'])
      .optional(),
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().max(500).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export type ShipOrderInput = z.infer<typeof shipOrderSchema>;
export type FlagOrderIssueInput = z.infer<typeof flagOrderIssueSchema>;
export type PharmacyQueueQuery = z.infer<typeof pharmacyQueueQuerySchema>;

/**
 * The fill queue as a table.
 *
 * Separate from `pharmacyQueueQuerySchema` because the two answer different
 * questions. The keyset version is a feed — "give me the next few, oldest
 * first" — and cannot express "page 4 of 11". A pharmacist working a queue
 * wants page numbers, a sortable column and a filter they can share as a URL,
 * which is what this one is for.
 */
export const PHARMACY_ORDER_STATUSES = [
  'QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT',
  'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED',
] as const;

export const pharmacyOrderTableQuerySchema = listQuerySchema.extend({
  /** One or more statuses, comma separated. */
  status: z.string().trim().max(200).optional(),
  /** One or more carriers, comma separated. */
  carrier: z.string().trim().max(200).optional(),
  /** One or more two-letter state codes, comma separated. */
  state: z.string().trim().max(200).toUpperCase().optional(),
  /** `open` hides everything already shipped or finished. */
  scope: z.enum(['open', 'all']).default('open'),
});

export type PharmacyOrderTableQuery = z.infer<typeof pharmacyOrderTableQuerySchema>;
