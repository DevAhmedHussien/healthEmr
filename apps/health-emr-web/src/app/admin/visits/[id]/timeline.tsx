import { type VisitStage } from '@health-emr/types';
import { Card } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';

/**
 * The journey as a row of steps, with the one it is on marked.
 *
 * A badge answers "where is this"; the steps answer "and what is left". Refused,
 * stuck and cancelled visits are not on this track at all — drawing a progress
 * bar through a refusal implies it is still going somewhere.
 */
const TRACK: { stage: VisitStage; label: string }[] = [
  { stage: 'PENDING_REVIEW', label: 'Submitted' },
  { stage: 'APPROVED', label: 'Approved' },
  { stage: 'SENT_TO_PHARMACY', label: 'At pharmacy' },
  { stage: 'BEING_FILLED', label: 'Being filled' },
  { stage: 'SHIPPED', label: 'Shipped' },
  { stage: 'DELIVERED', label: 'Delivered' },
];

const OFF_TRACK: VisitStage[] = ['REFUSED', 'CANCELLED', 'STUCK', 'INFO_NEEDED'];

interface Order {
  submittedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export function Timeline({
  stage,
  submittedAt,
  decidedAt,
  orders,
}: {
  stage: VisitStage;
  submittedAt: string;
  decidedAt: string | null;
  orders: Order[];
}) {
  if (OFF_TRACK.includes(stage)) return null;

  const reached = TRACK.findIndex((step) => step.stage === stage);
  const order = orders[0] ?? null;

  const when: Partial<Record<VisitStage, string | null>> = {
    PENDING_REVIEW: submittedAt,
    APPROVED: decidedAt,
    SENT_TO_PHARMACY: order?.submittedAt ?? null,
    SHIPPED: order?.shippedAt ?? null,
    DELIVERED: order?.deliveredAt ?? null,
  };

  return (
    <Card>
      <ol className="flex flex-wrap items-start gap-x-2 gap-y-4">
        {TRACK.map((step, index) => {
          const done = index < reached;
          const current = index === reached;
          const timestamp = when[step.stage];

          return (
            <li key={step.stage} className="flex min-w-[8rem] flex-1 items-start gap-2">
              <span
                aria-hidden
                className={[
                  'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full',
                  done || current ? 'bg-[var(--ar-primary)]' : 'bg-[var(--ar-border)]',
                ].join(' ')}
              />
              <span className="min-w-0">
                <span
                  className={[
                    'block text-[0.82rem]',
                    current
                      ? 'font-semibold text-[var(--ar-headings)]'
                      : done
                        ? 'text-[var(--ar-body-color)]'
                        : 'text-[var(--ar-text-faint)]',
                  ].join(' ')}
                >
                  {step.label}
                  {current ? <span className="sr-only"> (current step)</span> : null}
                </span>
                {timestamp && (done || current) ? (
                  <span className="block text-[0.7rem] tabular-nums text-[var(--ar-text-faint)]">
                    {formatDateTime(timestamp)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
