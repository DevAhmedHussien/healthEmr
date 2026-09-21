/** Beluga's `visitType` vocabulary. These are Category slugs in our catalog. */
export const VISIT_TYPES = [
  'testVisitType',
  'weightloss',
  'weightlossfollowup',
  'ED',
  'EDfollowup',
  'antiAging',
  'antiAgingFollowup',
  'antiNausea',
  'antiNauseaFollowup',
  'menopause',
  'menopauseFollowup',
  'hairloss',
  'hairlossfollowup',
] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
] as const;
export type UsState = (typeof US_STATES)[number];

export const RequestStatus = {
  RECEIVED: 'RECEIVED',
  PENDING_ASSIGNMENT: 'PENDING_ASSIGNMENT',
  ASSIGNED: 'ASSIGNED',
  IN_REVIEW: 'IN_REVIEW',
  INFO_REQUESTED: 'INFO_REQUESTED',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

/**
 * Outbound event names live in `webhooks.ts`.
 *
 * A list of internal domain-event strings stood here — `visit.approved` and
 * friends — which is the vocabulary contexts use to talk to each other, not the
 * one a client's CRM subscribes to. Publishing internal names as a public
 * contract would have tied our seams to somebody else's integration.
 */
