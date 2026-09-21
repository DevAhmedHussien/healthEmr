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
} from './money-chart';
import { formatMoney } from '@/lib/format';
import { Figure } from '@/components/ui/figure';

interface Bucket {
  period: string;
  orders: number;
  revenueCents: number;
  costOfGoodsCents: number;
  providerFeesCents: number;
  profitCents: number;
  pricedShare: number;
}

/**
 * Revenue, cost and profit over time, for the platform or one client.
 *
 * The bar is a stack because the relationship is additive — cost plus fees plus
 * profit is revenue — so the shape shows the margin without the reader
 * subtracting two neighbours.
 */
export function RevenuePanel({
  endpoint,
  title = 'Revenue and profit',
  subtitle = 'Charged per approved medication. A refused visit earns nothing.',
}: {
  /** BFF path of the series endpoint, without a grain. */
  endpoint: string;
  title?: string;
  subtitle?: string;
}) {
  const [grain, setGrain] = React.useState<Grain>('month');
  const { data: buckets, error } = useSeries<Bucket>(endpoint, grain);

  const columns: Column[] = (buckets ?? []).map((bucket) => ({
    period: bucket.period,
    label: bucketLabel(bucket.period, grain),
    segments: [
      { key: 'profit', label: 'Profit', value: bucket.profitCents, color: CHART_COLORS.profit },
      {
        key: 'cost',
        label: 'Cost of goods',
        value: bucket.costOfGoodsCents,
        color: CHART_COLORS.cost,
      },
      {
        key: 'fees',
        label: 'Clinician fees',
        value: bucket.providerFeesCents,
        color: CHART_COLORS.fees,
      },
    ],
  }));

  /**
   * The most recent period against the one before it.
   *
   * The totals above answer "how much"; this answers "which way", which is the
   * question someone opening a dashboard on a Monday actually has. Only shown
   * once there are two periods with money in them — a first month compared
   * against a month that predates the company is not a trend.
   */
  const trend = React.useMemo(() => {
    const withMoney = (buckets ?? []).filter((bucket) => bucket.revenueCents > 0);
    if (withMoney.length < 2) return null;

    const latest = withMoney[withMoney.length - 1];
    const previous = withMoney[withMoney.length - 2];

    return {
      revenue: change(previous.revenueCents, latest.revenueCents),
      profit: change(previous.profitCents, latest.profitCents),
    };
  }, [buckets]);

  const totals = (buckets ?? []).reduce(
    (acc, bucket) => ({
      revenue: acc.revenue + bucket.revenueCents,
      cost: acc.cost + bucket.costOfGoodsCents,
      fees: acc.fees + bucket.providerFeesCents,
      profit: acc.profit + bucket.profitCents,
      orders: acc.orders + bucket.orders,
      unpriced: acc.unpriced + Math.round(bucket.orders * (1 - bucket.pricedShare)),
    }),
    { revenue: 0, cost: 0, fees: 0, profit: 0, orders: 0, unpriced: 0 },
  );

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={<GrainToggle grain={grain} onChange={setGrain} />}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {buckets === null && !error ? (
        <Skeleton className="h-[200px] w-full" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Figure
              label="Revenue"
              value={formatMoney(totals.revenue)}
              trailing={trend?.revenue != null ? <Delta percent={trend.revenue} /> : null}
            />
            <Figure label="Cost of goods" value={formatMoney(totals.cost)} tone="muted" />
            <Figure label="Clinician fees" value={formatMoney(totals.fees)} tone="muted" />
            <Figure
              label="Profit"
              value={formatMoney(totals.profit)}
              tone="accent"
              trailing={trend?.profit != null ? <Delta percent={trend.profit} /> : null}
              hint={
                totals.revenue > 0
                  ? `${Math.round((totals.profit / totals.revenue) * 100)}% margin`
                  : undefined
              }
            />
          </div>

          <MoneyChart columns={columns} />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <ChartLegend
              segments={[
                { label: 'Profit', color: CHART_COLORS.profit },
                { label: 'Cost of goods', color: CHART_COLORS.cost },
                { label: 'Clinician fees', color: CHART_COLORS.fees },
              ]}
            />
            <span className="text-[0.72rem] text-[var(--ar-text-faint)]">
              {totals.orders} medications dispensed
            </span>
          </div>

          {totals.unpriced > 0 ? (
            <div className="mt-3">
              <Alert tone="warning">
                {totals.unpriced} of {totals.orders} orders came from a product with no sell price,
                so they cost us and earned nothing. Profit above is lower than the real figure until
                those are priced.
              </Alert>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Percentage change, or null where the base is zero and a ratio means nothing. */
function change(from: number, to: number): number | null {
  if (from === 0) return null;
  return Math.round(((to - from) / Math.abs(from)) * 100);
}

/**
 * Which way the latest period went.
 *
 * The arrow and the sign both carry the direction, so it survives being read in
 * greyscale or by someone who cannot separate the red from the green — colour
 * alone would be the only signal otherwise.
 */
function Delta({ percent }: { percent: number }) {
  const rising = percent >= 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-[0.72rem] font-medium tabular-nums ${
        rising ? 'text-[var(--ar-on-success)]' : 'text-[var(--ar-danger)]'
      }`}
      title="Change on the previous period"
    >
      <span aria-hidden="true">{rising ? '↑' : '↓'}</span>
      {rising ? '+' : ''}
      {percent}%<span className="sr-only">{rising ? 'up' : 'down'} on the previous period</span>
    </span>
  );
}
