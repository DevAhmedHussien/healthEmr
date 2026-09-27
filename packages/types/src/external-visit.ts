import { z } from 'zod';

/**
 * The external visit surface: update, resend, cancel, and the two lookups.
 *
 * Shaped to the incumbent's contract so a client already integrated against
 * Beluga can repoint by changing a base URL. That includes the parts we would
 * not have chosen — a status string in a 200 body rather than an HTTP code, and
 * an `apiKey` in the payload as well as the header — because a contract a
 * client has already written against is not ours to improve unilaterally.
 */

/**
 * A required string, with the three empty shapes refused by name.
 *
 * The contract says no field may arrive null, undefined or empty, and each of
 * those fails differently by default: `undefined` reads as "absent", `null` as
 * a type error, `''` as a perfectly good string. Saying so once here means the
 * message a client gets back names the field and the reason rather than
 * quoting a Zod internal.
 */
const required = (field: string, max = 250) =>
  z
    .string({
      required_error: `${field} is required`,
      invalid_type_error: `${field} must be a string, not null or a number`,
    })
    .trim()
    .min(1, `${field} must not be empty`)
    .max(max, `${field} must be ${max} characters or fewer`);

/** One line of what the patient is asking to be prescribed. */
export const externalPreferenceSchema = z
  .object({
    name: required('name'),
    strength: required('strength', 120),
    refills: required('refills', 50),
    quantity: required('quantity', 50),
    /** Required here, unlike on intake, because a resend must be unambiguous. */
    daysSupply: required('daysSupply', 50),
    medId: required('medId', 120),
  })
  .strict();

export const updateVisitSchema = z
  .object({
    patientPreference: z
      .array(externalPreferenceSchema, {
        required_error: 'patientPreference is required',
        invalid_type_error: 'patientPreference must be an array',
      })
      .min(1, 'patientPreference must contain at least one medication'),
    pharmacyId: required('pharmacyId', 120),
    /** Optional: the path names the visit. Sent here too, it must agree. */
    masterId: z.string().trim().max(255).optional(),
    /**
     * The same key as the Authorization header carries.
     *
     * Redundant by design: the incumbent took it in the body, and a client
     * migrating from it sends both. We check that the two agree rather than
     * ignoring one — a payload whose key names a different account than the
     * header is a misrouted request, not a harmless duplication.
     */
    apiKey: required('apiKey', 200),
  })
  .strict();

export const cancelVisitSchema = z
  .object({
    /** Optional: the path names the visit. Sent here too, it must agree. */
    masterId: z.string().trim().max(255).optional(),
    apiKey: required('apiKey', 200),
    reason: required('reason', 500),
  })
  .strict();

export type ExternalPreference = z.infer<typeof externalPreferenceSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;
export type CancelVisitInput = z.infer<typeof cancelVisitSchema>;

/** Every status this surface can answer with. */
export const EXTERNAL_STATUSES = [
  'VISIT_DATA_UPDATED',
  'NEW_RX_SENT',
  'VISIT_CANCELLED',
  'NO_VISIT',
  'VISIT_WAS_REFERRED',
  'TOO_MANY_RETRIES',
  'CATEGORY_MISMATCH',
  'PHARMACY_MISMATCH',
  'TOO_LONG_AGO',
  'ALREADY_SHIPPED',
  'RX_ERROR',
  'GENERIC',
] as const;

export type ExternalStatus = (typeof EXTERNAL_STATUSES)[number];

/**
 * How long a prescription stays open to being re-sent.
 *
 * Past this the clinical picture is no longer the one the clinician assessed,
 * and a resend is a new visit rather than a correction to an old one.
 */
export const RESEND_WINDOW_DAYS = 7;
