'use client';

import * as React from 'react';
import { Alert, Card, CardHeader, Skeleton } from '@/components/ui/primitives';
import {
  CHART_COLORS,
  ChartLegend,
  GrainToggle,
  MoneyChart,
  bucketLabel,
  useSeries,
  type Column,
  type Grain,
} from '@/components/portal/money-chart';
import { formatMoney, formatNumber } from '@/lib/format';

interface Bucket {
  period: string;
  medications: number;
  earnedCents: number;
  spendCents: number;
  marginCents: number;
  pricedShare: number;
  patientPricedShare: number;
}

/**
 * This business's own economics, over time.
 *
 * The stack is their money: what they owe us, plus what they kept, is what their
 * patients paid. The same shape as the platform's chart but a different set of
 * numbers — our cost of goods and our margin are not in it, because the API
 * never sends them. This component has nothing to withhold; it has nothing else
 * to draw.
 */
export function SpendPanel() {
  const [grain, setGrain] = React.useState<Grain>('month');
  const { data: buckets, error } = useSeries<Bucket>('v1/admin/spend/series', grain);

  const columns: Column[] = (buckets ?? []).map((bucket) => ({
    period: bucket.period,
    label: bucketLabel(bucket.period, grain),
    segments: [
      {
        key: 'margin',
        label: 'Your margin',
        value: bucket.marginCents,
        color: CHART_COLORS.profit,
      },
      { key: 'spend', label: 'You owe us', value: bucket.spendCents, color: CHART_COLORS.cost },
    ],
  }));

  const totals = (buckets ?? []).reduce(
    (acc, bucket) => ({
      earned: acc.earned + bucket.earnedCents,
      margin: acc.margin + bucket.marginCents,
      medications: acc.medications + bucket.medications,
    }),
    { earned: 0, margin: 0, medications: 0 },
  );

  return (
    <Card>
      <CardHeader
        title="Your margin over time"
        subtitle="What patients paid you, split into what you owe us and what you kept."
        action={<GrainToggle grain={grain} onChange={setGrain} />}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {buckets === null && !error ? (
        <Skeleton className="h-[200px] w-full" />
      ) : (
        <>
          <MoneyChart columns={columns} emptyLabel="Nothing charged in this period." />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <ChartLegend
              segments={[
                { label: 'Your margin', color: CHART_COLORS.profit },
                { label: 'You owe us', color: CHART_COLORS.cost },
              ]}
            />
            <span className="text-[0.78rem] text-[var(--ar-text-muted)]">
              {formatMoney(totals.earned)} taken · {formatMoney(totals.margin)} kept ·{' '}
              {formatNumber(totals.medications)} medication{totals.medications === 1 ? '' : 's'}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
