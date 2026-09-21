import type { VisitType } from '@health-emr/types';

/**
 * Readable URLs for each visit type.
 *
 * The platform's internal names (`antiAging`, `ED`) are the client contract and
 * cannot change, but they are not what you want in a link handed to a patient.
 * This is the one place the two vocabularies meet.
 */
export const FORMS: Array<{
  slug: string;
  visitType: VisitType;
  title: string;
  blurb: string;
  followUp?: boolean;
}> = [
  {
    slug: 'weight-loss',
    visitType: 'weightloss',
    title: 'Weight loss',
    blurb: 'GLP-1 treatment, assessed by a clinician.',
  },
  {
    slug: 'weight-loss-followup',
    visitType: 'weightlossfollowup',
    title: 'Weight loss follow-up',
    blurb: 'Continuing or changing an existing course.',
    followUp: true,
  },
  {
    slug: 'sexual-health',
    visitType: 'ED',
    title: 'Sexual health',
    blurb: 'Treatment for erectile dysfunction.',
  },
  {
    slug: 'sexual-health-followup',
    visitType: 'EDfollowup',
    title: 'Sexual health follow-up',
    blurb: 'Reviewing how the current treatment is going.',
    followUp: true,
  },
  {
    slug: 'wellness',
    visitType: 'antiAging',
    title: 'Wellness',
    blurb: 'Energy, sleep, recovery and longevity support.',
  },
  {
    slug: 'wellness-followup',
    visitType: 'antiAgingFollowup',
    title: 'Wellness follow-up',
    blurb: 'Continuing an existing wellness course.',
    followUp: true,
  },
  {
    slug: 'hair-growth',
    visitType: 'hairloss',
    title: 'Hair growth',
    blurb: 'Treatment for thinning and hair loss.',
  },
  {
    slug: 'hair-growth-followup',
    visitType: 'hairlossfollowup',
    title: 'Hair growth follow-up',
    blurb: 'Reviewing an existing course.',
    followUp: true,
  },
  {
    slug: 'anti-nausea',
    visitType: 'antiNausea',
    title: 'Anti-nausea',
    blurb: 'Relief from nausea, often alongside a GLP-1.',
  },
  {
    slug: 'anti-nausea-followup',
    visitType: 'antiNauseaFollowup',
    title: 'Anti-nausea follow-up',
    blurb: 'Continuing existing anti-nausea treatment.',
    followUp: true,
  },
  {
    slug: 'menopause',
    visitType: 'menopause',
    title: 'Menopause',
    blurb: 'Hormone and symptom support.',
  },
  {
    slug: 'menopause-followup',
    visitType: 'menopauseFollowup',
    title: 'Menopause follow-up',
    blurb: 'Reviewing an existing course.',
    followUp: true,
  },
  {
    slug: 'test',
    visitType: 'testVisitType',
    title: 'Integration test',
    blurb: 'One question. For checking a payload end to end.',
  },
];

export function formFor(slug: string) {
  return FORMS.find((form) => form.slug === slug);
}
