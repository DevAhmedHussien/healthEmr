import { z } from 'zod';
import { US_STATES, VISIT_TYPES } from './enums';

/**
 * The partner intake contract.
 *
 * Deliberately shaped to match the Beluga / Joey Med `createNoPayPhotos` payload
 * field-for-field, so an existing Beluga integration can repoint at HealthEMR by
 * changing a base URL and a token. Their convention — no field may be null,
 * undefined or an empty string unless documented optional — is enforced here with
 * `.min(1)` on every string and `.strict()` on every object.
 */

const nonEmpty = (max: number, label: string) =>
  z.string().trim().min(1, `${label} error`).max(max, `${label} error`);

/**
 * MM-DD-YYYY or MM/DD/YYYY, a real calendar date, 18 or older.
 *
 * Both separators are accepted and normalised to slashes. The contract has
 * always documented slashes and clients send them, but a person typing into a
 * form should not have to reach for a second keyboard to enter a date — so the
 * form uses dashes and this meets it halfway rather than making the display
 * disagree with what is submitted.
 */
export const dobSchema = z
  .string()
  .transform((value) => value.replace(/-/g, '/'))
  .refine((value) => /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}$/.test(value), 'Dob error')
  .superRefine((value, ctx) => {
    const [mm, dd, yyyy] = value.split('/').map(Number);
    const date = new Date(Date.UTC(yyyy, mm - 1, dd));
    const realDate =
      date.getUTCFullYear() === yyyy && date.getUTCMonth() === mm - 1 && date.getUTCDate() === dd;
    if (!realDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Dob error' });
      return;
    }
    const eighteenth = new Date(Date.UTC(yyyy + 18, mm - 1, dd));
    if (eighteenth.getTime() > Date.now()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Patient must be 18 or older' });
    }
  });

export const patientPreferenceItemSchema = z
  .object({
    name: nonEmpty(200, 'patientPreference fields'),
    strength: nonEmpty(100, 'patientPreference fields'),
    quantity: nonEmpty(50, 'patientPreference fields'),
    refills: nonEmpty(50, 'patientPreference fields'),
    /** Optional in the partner spec; every other line field is required. */
    daysSupply: z.string().trim().max(50).optional(),
    medId: nonEmpty(120, 'patientPreference fields'),
    /**
     * What the patient paid for this line, in whole cents.
     *
     * The client business's own retail price — not ours. Sent per line rather
     * than per order because a visit can carry several medications at different
     * prices, and a single order total cannot be attributed to any of them.
     *
     * Optional: a partner that does not send it simply reports no revenue of its
     * own, and its margin is shown as unknown rather than as zero.
     */
    patientPaidCents: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict();

/** `Q1`/`A1` … `Qn`/`An` ride alongside the fixed fields on `formObj`. */
const CUSTOM_QA_KEY = /^[QA][1-9]\d*$/;

export const formObjSchema = z
  .object({
    consentsSigned: z.literal(true, { errorMap: () => ({ message: 'consentsSigned must be true' }) }),
    firstName: nonEmpty(100, 'firstName or lastName'),
    lastName: nonEmpty(100, 'firstName or lastName'),
    dob: dobSchema,
    phone: z.string().regex(/^\d{10}$/, 'Phone number error'),
    email: z.string().trim().min(1, 'Email error').email('Email error'),
    address: nonEmpty(200, 'Address'),
    city: nonEmpty(120, 'City'),
    state: z.enum(US_STATES, { errorMap: () => ({ message: 'State error' }) }),
    zip: z.string().regex(/^\d{5}$/, 'Zip error'),
    sex: z.enum(['Male', 'Female'], { errorMap: () => ({ message: 'Sex error' }) }),
    selfReportedMeds: nonEmpty(2000, 'SelfReportedMeds'),
    allergies: nonEmpty(2000, 'Allergies'),
    medicalConditions: nonEmpty(2000, 'MedicalConditions'),
    patientPreference: z
      .array(patientPreferenceItemSchema)
      .min(1, 'patientPreference fields error'),
  })
  .catchall(z.string().trim().min(1, 'Missing values'))
  .superRefine((value, ctx) => {
    const known = new Set([
      'consentsSigned','firstName','lastName','dob','phone','email','address','city','state','zip',
      'sex','selfReportedMeds','allergies','medicalConditions','patientPreference',
    ]);
    const bad = Object.keys(value).filter((k) => !known.has(k) && !CUSTOM_QA_KEY.test(k));
    if (bad.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Payload contains bad fields: ${bad.join(', ')}`,
      });
    }
  });

export const partnerIntakeSchema = z
  .object({
    formObj: formObjSchema,
    pharmacyId: nonEmpty(120, 'Pharmacy'),
    /** Client-generated idempotency key, unique per visit per tenant. */
    masterId: nonEmpty(255, 'masterId'),
    /** The tenant slug. Must agree with the tenant the API key resolves to. */
    company: nonEmpty(120, 'company'),
    visitType: z.enum(VISIT_TYPES, {
      errorMap: () => ({ message: 'Company does not have that visit type' }),
    }),
  })
  .strict();

export type PatientPreferenceItem = z.infer<typeof patientPreferenceItemSchema>;
export type PartnerIntake = z.infer<typeof partnerIntakeSchema>;

/** Pull the Q/A pairs out of formObj in question order. */
export function extractCustomQa(formObj: Record<string, unknown>): Array<{
  questionId: string;
  question: string;
  answer: string;
}> {
  const questions = Object.keys(formObj)
    .filter((k) => /^Q[1-9]\d*$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  return questions.map((qKey) => {
    const index = qKey.slice(1);
    return {
      questionId: qKey,
      question: String(formObj[qKey] ?? ''),
      answer: String(formObj[`A${index}`] ?? ''),
    };
  });
}

/**
 * Photos for a visit, posted after it exists.
 *
 * Matches the contract clients already send: the visit id the intake returned,
 * and base64 images. `kind` is ours and optional — a client that does not send
 * it gets the government ID, which is what the overwhelming majority are.
 */
export const visitPhotosSchema = z
  .object({
    visitId: nonEmpty(120, 'visitId'),
    images: z
      .array(
        z.object({
          mime: nonEmpty(120, 'mime'),
          data: z.string().min(1, 'Image data error'),
        }),
      )
      .min(1, 'Images error')
      .max(10, 'Images error'),
    kind: z.enum(['ID_PHOTO', 'RX_PHOTO']).default('ID_PHOTO'),
  })
  .strict();

export type VisitPhotosInput = z.infer<typeof visitPhotosSchema>;

/**
 * Correcting a visit that has already been submitted.
 *
 * Deliberately narrow. Everything here is contact and delivery information —
 * the things a patient mistypes and a client wants to fix before a parcel goes
 * to the wrong street. The clinical content is not editable: the questionnaire
 * is what the patient attested to, and a chart whose answers can be changed
 * after the fact is not evidence of anything.
 *
 * The API refuses this once a clinician has decided, because at that point the
 * answers have been read and relied on. Correct the address with the pharmacy,
 * or withdraw the visit and submit a new one.
 */
export const partnerVisitUpdateSchema = z
  .object({
    phone: z.string().regex(/^\d{10}$/, 'Phone number error').optional(),
    email: z.string().trim().min(1).email('Email error').optional(),
    address: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state: z.enum(US_STATES, { errorMap: () => ({ message: 'State error' }) }).optional(),
    zip: z.string().regex(/^\d{5}$/, 'Zip error').optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export type PartnerVisitUpdate = z.infer<typeof partnerVisitUpdateSchema>;

/** Withdrawing a visit. The reason is written to the audit trail, so it is required. */
export const voidVisitSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'Say why this visit is being withdrawn — it is written to the audit log')
      .max(500),
    /**
     * Withdraw a visit whose medication has already shipped.
     *
     * Refused without this, because the parcel is real and a record saying the
     * visit was withdrawn contradicts a medication that reached a patient. The
     * flag exists so the platform owner can still do it deliberately — a
     * duplicate order, a test that went out by mistake — and the audit entry
     * records that it had shipped when they did.
     */
    force: z.boolean().optional(),
  })
  .strict();

/**
 * The platform owner correcting a visit, at any stage.
 *
 * Wider than the client's own `PATCH /partner/v1/visit/{masterId}`, which stops
 * accepting changes once a clinician has decided. This does not stop, because
 * the cases it exists for are the ones that arrive by phone after the fact: a
 * patient who moved, an order routed to the wrong pharmacy, a status that needs
 * correcting because something happened outside the system.
 *
 * The questionnaire is still not editable by anyone. It is what the patient
 * attested to, and answers that can be rewritten afterwards are not evidence.
 */
export const adminVisitPatchSchema = z
  .object({
    phone: z.string().regex(/^\d{10}$/, 'Phone number error').optional(),
    email: z.string().trim().min(1).email('Email error').optional(),
    address: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state: z.enum(US_STATES, { errorMap: () => ({ message: 'State error' }) }).optional(),
    zip: z.string().regex(/^\d{5}$/, 'Zip error').optional(),
    /** Slug or id of the pharmacy this should be filled by. */
    pharmacyId: z.string().trim().min(1).max(120).optional(),
    /** A correction, for when the truth moved outside the system. */
    status: z
      .enum(['RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED'])
      .optional(),
    reason: z
      .string()
      .trim()
      .min(10, 'Say why this is being changed — it is written to the audit log')
      .max(500),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: 'Send at least one field to change, alongside the reason',
  });

export type AdminVisitPatch = z.infer<typeof adminVisitPatchSchema>;

export type VoidVisitInput = z.infer<typeof voidVisitSchema>;
