import { Role } from '@health-emr/types';

/**
 * Which parts of a chart each role may see.
 *
 * This exists because "the pharmacy sees allergies but never why the patient
 * sought care" is a real access rule, and the only safe way to express it is a
 * single declared policy that the services read — not a set of hand-picked
 * `select` clauses scattered across controllers, where the one somebody forgets
 * is the leak.
 *
 * HIPAA calls this minimum necessary (45 CFR 164.502(b)): each party gets the
 * least PHI required to do its job. The job differs by role, so the lists differ
 * too — and because they live here, widening one is a reviewable diff rather
 * than an invisible change to somebody's `select`.
 */
export const ChartSection = {
  DEMOGRAPHICS: 'DEMOGRAPHICS',
  CONTACT: 'CONTACT',
  ID_PHOTO: 'ID_PHOTO',
  ORDER_STATUS: 'ORDER_STATUS',
  SHIPPING: 'SHIPPING',
  BILLING: 'BILLING',
  PRESCRIPTIONS: 'PRESCRIPTIONS',
  ALLERGIES: 'ALLERGIES',
  CONDITIONS: 'CONDITIONS',
  MEDICATION_HISTORY: 'MEDICATION_HISTORY',
  VITALS: 'VITALS',
  QA_ANSWERS: 'QA_ANSWERS',
  CLINICAL_IMAGES: 'CLINICAL_IMAGES',
  PROVIDER_NOTES: 'PROVIDER_NOTES',
  LAB_RESULTS: 'LAB_RESULTS',
} as const;

export type ChartSection = (typeof ChartSection)[keyof typeof ChartSection];

const ALL: ChartSection[] = Object.values(ChartSection);

const POLICY: Record<Role, ChartSection[]> = {
  // Platform owner. Sees everything, and every read is logged as break-the-glass.
  [Role.SUPER_ADMIN]: ALL,

  // The treating clinician. Needs the whole picture to prescribe safely.
  [Role.PROVIDER]: ALL,

  // The patient's own chart.
  [Role.PATIENT]: ALL,

  /**
   * The telehealth business.
   *
   * This is the company that owns the patient relationship: it ran the intake,
   * it took the payment, and its support desk is who the patient calls. Minimum
   * necessary is judged against the job, and that job includes answering "why
   * was I refused" and "I already told you that" — which needs the questionnaire
   * this business collected and the photos the patient uploaded to it.
   *
   * Two things stay withheld, and the line is deliberate. Provider notes are the
   * clinician's own reasoning, written for the chart rather than the customer;
   * lab results come from outside the intake this business ran. Everything the
   * patient submitted here comes back — what a clinician subsequently wrote
   * about it does not.
   *
   * Tenancy still binds underneath: the Prisma extension confines every query to
   * the caller's tenant, so this reaches their own patients and nobody else's.
   */
  [Role.ADMIN]: [
    ChartSection.DEMOGRAPHICS,
    ChartSection.CONTACT,
    ChartSection.ID_PHOTO,
    ChartSection.ORDER_STATUS,
    ChartSection.SHIPPING,
    ChartSection.BILLING,
    ChartSection.PRESCRIPTIONS,
    ChartSection.QA_ANSWERS,
    ChartSection.CLINICAL_IMAGES,
    ChartSection.ALLERGIES,
    ChartSection.CONDITIONS,
    ChartSection.MEDICATION_HISTORY,
    ChartSection.VITALS,
  ],

  /**
   * The dispensing pharmacy.
   *
   * Allergies are included and deliberately so — dispensing without them is
   * dangerous. Everything about why the patient sought care is excluded.
   */
  [Role.PHARMACY]: [
    ChartSection.DEMOGRAPHICS,
    ChartSection.CONTACT,
    ChartSection.SHIPPING,
    ChartSection.PRESCRIPTIONS,
    ChartSection.ALLERGIES,
    ChartSection.MEDICATION_HISTORY,
    ChartSection.ORDER_STATUS,
  ],
};

export function canSee(role: Role, section: ChartSection): boolean {
  return POLICY[role]?.includes(section) ?? false;
}

export function visibleSections(role: Role): ChartSection[] {
  return POLICY[role] ?? [];
}

/**
 * Strips sections the role may not see, and says so rather than silently
 * omitting them — a UI that knows a field was withheld can explain why, and a
 * reviewer can tell redaction from absence.
 */
export function redactChart<T extends Record<string, unknown>>(
  role: Role,
  chart: T,
  sectionOf: Partial<Record<keyof T, ChartSection>>,
): T & { redactedSections: string[] } {
  const output = { ...chart } as Record<string, unknown>;
  const redacted: string[] = [];

  for (const [field, section] of Object.entries(sectionOf) as Array<[string, ChartSection]>) {
    if (!canSee(role, section)) {
      delete output[field];
      if (!redacted.includes(section)) redacted.push(section);
    }
  }

  return { ...(output as T), redactedSections: redacted };
}
