'use client';

import { VISIT_STAGE_LABEL, VISIT_STAGE_MEANING, type VisitStage } from '@health-emr/types';
import { Badge } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Where a visit has got to, as one badge.
 *
 * Colour carries the same information twice over — a stage that needs somebody's
 * attention is red whether or not the reader knows what "stuck" means here — and
 * the tooltip spells the stage out in the words a support desk would use with a
 * patient, because "being filled" and "sent to pharmacy" are not obviously
 * different until somebody says so.
 */
const TONE: Record<VisitStage, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  PENDING_REVIEW: 'warning',
  INFO_NEEDED: 'warning',
  REFUSED: 'danger',
  APPROVED: 'info',
  SENT_TO_PHARMACY: 'info',
  BEING_FILLED: 'info',
  SHIPPED: 'success',
  DELIVERED: 'success',
  STUCK: 'danger',
  CANCELLED: 'neutral',
};

export function StageBadge({ stage }: { stage: VisitStage }) {
  return (
    <Tooltip content={VISIT_STAGE_MEANING[stage]}>
      <Badge tone={TONE[stage]}>{VISIT_STAGE_LABEL[stage]}</Badge>
    </Tooltip>
  );
}

/** The stage dropdown's options, in the order a visit moves through them. */
export const STAGE_OPTIONS = (Object.keys(VISIT_STAGE_LABEL) as VisitStage[]).map((stage) => ({
  value: stage,
  label: VISIT_STAGE_LABEL[stage],
}));
