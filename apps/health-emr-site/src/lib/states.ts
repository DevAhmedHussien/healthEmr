/** The states a licence or a shipping lane can name. */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const;

export type UsState = (typeof US_STATES)[number];

/**
 * The treatment areas a clinician can ask to be credentialled for.
 *
 * Slugs must match the platform's own categories exactly — they are sent as
 * `requestedCategorySlugs` and are meaningless to it otherwise. Follow-up
 * categories are deliberately absent: nobody applies to review follow-ups
 * separately from the treatment they follow.
 */
export const CATEGORIES = [
  { slug: 'weightloss', label: 'Weight management' },
  { slug: 'ED', label: 'Sexual health' },
  { slug: 'hormones', label: 'Hormones' },
  { slug: 'peptides', label: 'Peptides' },
  { slug: 'hairloss', label: 'Hair loss' },
  { slug: 'antiAging', label: 'Anti-ageing' },
  { slug: 'menopause', label: 'Menopause' },
  { slug: 'skin', label: 'Skin' },
  { slug: 'antiNausea', label: 'Anti-nausea' },
] as const;
