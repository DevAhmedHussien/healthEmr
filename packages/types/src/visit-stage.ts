/**
 * Where a visit has got to, as one answer.
 *
 * The platform tracks three statuses on three tables — the request a clinician
 * reviews, the prescription they sign, and the order a pharmacy fills. That
 * separation is right internally, because each moves independently. It is the
 * wrong shape for a client business, which asks one question: where is this?
 *
 * Deriving the answer rather than storing it means there is nothing to keep in
 * step. A stage is always a reading of the underlying records, so it cannot go
 * stale or disagree with them.
 */
export const VISIT_STAGES = [
  'PENDING_REVIEW',
  'INFO_NEEDED',
  'REFUSED',
  'APPROVED',
  'SENT_TO_PHARMACY',
  'BEING_FILLED',
  'SHIPPED',
  'DELIVERED',
  'STUCK',
  'CANCELLED',
] as const;

export type VisitStage = (typeof VISIT_STAGES)[number];

export const VISIT_STAGE_LABEL: Record<VisitStage, string> = {
  PENDING_REVIEW: 'Pending review',
  INFO_NEEDED: 'More information needed',
  REFUSED: 'Refused',
  APPROVED: 'Approved',
  SENT_TO_PHARMACY: 'Sent to pharmacy',
  BEING_FILLED: 'Being filled',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  STUCK: 'Stuck',
  CANCELLED: 'Cancelled',
};

/** What each stage means, in the words a client would use with a patient. */
export const VISIT_STAGE_MEANING: Record<VisitStage, string> = {
  PENDING_REVIEW: 'A clinician has it and has not decided yet.',
  INFO_NEEDED: 'The clinician has asked the patient for something before deciding.',
  REFUSED: 'A clinician decided this treatment is not right for this patient.',
  APPROVED: 'Approved and signed. On its way to a pharmacy.',
  SENT_TO_PHARMACY: 'The pharmacy has it and has not started filling yet.',
  BEING_FILLED: 'The pharmacy is preparing it.',
  SHIPPED: 'On its way to the patient, with a tracking number.',
  DELIVERED: 'The patient has it.',
  STUCK: 'Nothing is moving and somebody needs to look — the pharmacy never received it.',
  CANCELLED: 'Stopped before it reached the patient.',
};

export interface VisitStageInput {
  requestStatus: string;
  prescriptionStatus?: string | null;
  orderStatus?: string | null;
  /** Set when a transmission to the pharmacy failed. */
  orderError?: string | null;
  orderSubmittedAt?: Date | string | null;
  /** When the prescription was signed, for judging whether it has stalled. */
  signedAt?: Date | string | null;
  /**
   * Overrides the clock.
   *
   * One stage — stuck because it stalled — depends on how long something has
   * been sitting, and a function that silently reads the wall clock is one a
   * test cannot pin. Production leaves this unset.
   */
  now?: Date;
}

/** How long an approved prescription may sit unsent before it counts as stuck. */
const STALLED_AFTER_HOURS = 6;

export function visitStage(input: VisitStageInput): VisitStage {
  const request = input.requestStatus;

  if (request === 'CANCELLED' || request === 'EXPIRED') return 'CANCELLED';
  if (request === 'DENIED') return 'REFUSED';
  if (request === 'INFO_REQUESTED') return 'INFO_NEEDED';
  if (request !== 'APPROVED') return 'PENDING_REVIEW';

  // Approved. From here the answer comes from the pharmacy side, which is what
  // the patient is actually waiting on.
  const prescription = input.prescriptionStatus;
  const order = input.orderStatus;

  if (prescription === 'VOIDED') return 'CANCELLED';

  // Furthest progress wins, and either record can be the one that knows. A
  // prescription still reading SHIPPED while the pharmacy reports the parcel
  // delivered is a lagging record, not a parcel in transit — so the test is
  // "did anything say delivered", before "did anything say shipped".
  if (prescription === 'DELIVERED' || order === 'DELIVERED') return 'DELIVERED';
  if (prescription === 'SHIPPED' || order === 'SHIPPED') return 'SHIPPED';
  if (order === 'IN_FULFILMENT' || prescription === 'DISPENSED') return 'BEING_FILLED';
  if (order === 'SUBMITTED' || order === 'ACKNOWLEDGED') return 'SENT_TO_PHARMACY';
  if (order === 'REJECTED' || order === 'CANCELLED') return 'STUCK';

  // Queued: either on its way, or it never left. A transmission error says so
  // outright; otherwise sitting unsent for hours is the same thing discovered
  // late, and a patient waiting on it deserves it surfaced either way.
  if (order === 'QUEUED') {
    if (input.orderError) return 'STUCK';
    const signed = input.signedAt ? new Date(input.signedAt).getTime() : null;
    const now = (input.now ?? new Date()).getTime();
    const stalled = signed !== null && now - signed > STALLED_AFTER_HOURS * 3_600_000;
    return stalled && !input.orderSubmittedAt ? 'STUCK' : 'APPROVED';
  }

  return 'APPROVED';
}

/** Whether the visit is still moving, for an "open work" filter. */
export function isOpenStage(stage: VisitStage): boolean {
  return !['DELIVERED', 'REFUSED', 'CANCELLED'].includes(stage);
}
