import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

/**
 * Where the money comes from, and what is left of it.
 *
 * Every figure here reads from `pharmacy_orders`, which is the one table that
 * knows all three numbers for a single fill: what we charge the client, what the
 * pharmacy charges us, and which client it was for. They are snapshotted onto
 * the row the moment the order is created, so a catalogue edited today cannot
 * restate what last quarter earned.
 *
 * Reading from orders also settles the refusals question by construction. An
 * order only exists once a clinician approved the line — a denied request never
 * produces one, so it can never be counted, whether or not somebody remembers to
 * write the filter.
 *
 * Provider fees are subtracted as the platform's other real cost: the clinician
 * is paid for the review whichever way it went, including the ones that earned
 * no revenue at all. Profit that ignored them would flatter every month.
 */

export type Grain = 'day' | 'week' | 'month';

export interface Bucket {
  /** ISO date at the start of the bucket. */
  period: string;
  orders: number;
  revenueCents: number;
  costOfGoodsCents: number;
  providerFeesCents: number;
  profitCents: number;
  /**
   * What patients paid the client business for these medications.
   *
   * The client's revenue, not ours — reported per line at intake. Carried here
   * so a client can see its own margin (what it took, less what we charge it)
   * without us having to hold a second set of books.
   */
  patientPaidCents: number;
  /** Share of orders whose line carried a patient price, 0–1. */
  patientPricedShare: number;
  /**
   * Share of orders in this bucket that carried a sell price, 0–1.
   *
   * Published beside the money so a partial total is never read as an exact one.
   * An unpriced product contributes an order and a cost but no revenue, which
   * makes profit look worse than it is — saying so is better than quietly
   * showing a number that is wrong in a direction nobody expects.
   */
  pricedShare: number;
}

interface SeriesRow {
  period: Date;
  orders: bigint;
  revenue: bigint | null;
  cost: bigint | null;
  priced: bigint;
  patientPaid: bigint | null;
  patientPriced: bigint;
}

interface FeeRow {
  period: Date;
  fees: bigint | null;
}

/** How far back each grain looks, and what the UI calls it. */
export const WINDOWS: Record<Grain, { interval: string; label: string }> = {
  day: { interval: '29 days', label: 'Last 30 days' },
  week: { interval: '12 weeks', label: 'Last 3 months' },
  month: { interval: '11 months', label: 'Last 12 months' },
};

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A bucketed series for the charts.
   *
   * Aggregated in Postgres rather than by loading rows and reducing in
   * JavaScript: a year of orders is a lot of rows to move across a socket to
   * produce twelve numbers, and the shape of the answer does not depend on any
   * of them individually.
   */
  async series(grain: Grain, tenantId?: string): Promise<Bucket[]> {
    const { interval } = WINDOWS[grain];

    return runWithoutTenantScope(async () => {
      const scope = tenantId ? Prisma.sql`AND o."tenantId" = ${tenantId}::uuid` : Prisma.empty;
      const feeScope = tenantId ? Prisma.sql`AND e."tenantId" = ${tenantId}::uuid` : Prisma.empty;

      const [orders, fees] = await Promise.all([
        this.prisma.raw.$queryRaw<SeriesRow[]>`
          SELECT date_trunc(${grain}, o."createdAt") AS period,
                 count(*)::bigint                                  AS orders,
                 coalesce(sum(o."sellPriceCents"), 0)::bigint      AS revenue,
                 coalesce(sum(o."costOfGoodsCents"), 0)::bigint    AS cost,
                 count(o."sellPriceCents")::bigint                 AS priced,
                 coalesce(sum(i."quotedPriceCents"), 0)::bigint    AS "patientPaid",
                 count(i."quotedPriceCents")::bigint               AS "patientPriced"
          FROM pharmacy_orders o
          -- What the patient paid rides on the request line, one hop away
          -- through the prescription. Joined rather than stored again on the
          -- order: two copies of one number is one copy too many.
          JOIN prescriptions p ON p.id = o."prescriptionId"
          JOIN prescription_request_items i ON i.id = p."requestItemId"
          -- A withdrawn visit is not billed and not counted. Joined rather than
          -- flagged on the order: the withdrawal happens on the visit, and a
          -- second copy of that fact is a second thing that can be wrong.
          JOIN prescription_requests r ON r.id = i."requestId"
          WHERE o."createdAt" >= date_trunc(${grain}, now()) - ${interval}::interval
            AND r."voidedAt" IS NULL
            -- A cancelled order was never dispensed and is never billed.
            AND o.status NOT IN ('CANCELLED', 'REJECTED')
            ${scope}
          GROUP BY 1
          ORDER BY 1
        `,
        this.prisma.raw.$queryRaw<FeeRow[]>`
          SELECT date_trunc(${grain}, e."earnedAt") AS period,
                 coalesce(sum(e."amountCents"), 0)::bigint AS fees
          FROM provider_earnings e
          WHERE e."earnedAt" >= date_trunc(${grain}, now()) - ${interval}::interval
            AND e.status <> 'VOID'
            ${feeScope}
          GROUP BY 1
          ORDER BY 1
        `,
      ]);

      const feeByPeriod = new Map(fees.map((row) => [key(row.period), Number(row.fees ?? 0)]));
      const orderByPeriod = new Map(orders.map((row) => [key(row.period), row]));

      // Built from a generated calendar rather than from whatever the query
      // returned: a week with no orders is a real zero, and a chart that simply
      // omits it draws a straight line through the gap and tells a nicer story
      // than the truth.
      return this.calendar(grain).map((period) => {
        const row = orderByPeriod.get(period);
        const revenueCents = Number(row?.revenue ?? 0);
        const costOfGoodsCents = Number(row?.cost ?? 0);
        const providerFeesCents = feeByPeriod.get(period) ?? 0;
        const count = Number(row?.orders ?? 0);

        return {
          period,
          orders: count,
          revenueCents,
          costOfGoodsCents,
          providerFeesCents,
          profitCents: revenueCents - costOfGoodsCents - providerFeesCents,
          patientPaidCents: Number(row?.patientPaid ?? 0),
          patientPricedShare: count ? Number(row?.patientPriced ?? 0) / count : 1,
          pricedShare: count ? Number(row?.priced ?? 0) / count : 1,
        };
      });
    });
  }

  /**
   * Headline totals for today, this month, and the last three months.
   *
   * Derived from the same series the chart draws, so the number above a chart
   * and the bars in it can never disagree — which they do the moment they are
   * two separate queries with two slightly different date boundaries.
   */
  async summary(tenantId?: string) {
    const [daily, monthly] = await Promise.all([
      this.series('day', tenantId),
      this.series('month', tenantId),
    ]);

    const today = daily[daily.length - 1] ?? empty(todayKey('day'));
    const thisMonth = monthly[monthly.length - 1] ?? empty(todayKey('month'));
    const lastThree = total(monthly.slice(-3));

    return {
      today: strip(today),
      thisMonth: strip(thisMonth),
      lastThreeMonths: strip(lastThree),
      // Named for what it is. This is the twelve-month series added up, and
      // calling it "all time" would be wrong the first day the platform is
      // thirteen months old — silently, and in the direction of looking smaller.
      last12Months: strip(total(monthly)),
    };
  }

  /**
   * The same figures split by client business.
   *
   * Super Admin only: this is the answer to "which of these accounts is actually
   * worth having", and it is not a client's business what another one pays.
   */
  async byTenant(grain: Grain = 'month') {
    const { interval } = WINDOWS[grain];

    return runWithoutTenantScope(async () => {
      const rows = await this.prisma.raw.$queryRaw<
        Array<{
          tenantId: string;
          name: string;
          slug: string;
          orders: bigint;
          revenue: bigint | null;
          cost: bigint | null;
          priced: bigint;
        }>
      >`
        SELECT t.id                                          AS "tenantId",
               t.name                                        AS name,
               t.slug                                        AS slug,
               count(o.*)::bigint                            AS orders,
               coalesce(sum(o."sellPriceCents"), 0)::bigint  AS revenue,
               coalesce(sum(o."costOfGoodsCents"), 0)::bigint AS cost,
               count(o."sellPriceCents")::bigint             AS priced
        FROM tenants t
        LEFT JOIN pharmacy_orders o
               ON o."tenantId" = t.id
              AND o."createdAt" >= date_trunc(${grain}, now()) - ${interval}::interval
              AND o.status NOT IN ('CANCELLED', 'REJECTED')
              -- Same exclusion as the series, or a client's own total and the
              -- platform's total for that client would disagree.
              AND NOT EXISTS (
                SELECT 1
                FROM prescriptions p
                JOIN prescription_request_items i ON i.id = p."requestItemId"
                JOIN prescription_requests r ON r.id = i."requestId"
                WHERE p.id = o."prescriptionId" AND r."voidedAt" IS NOT NULL
              )
        GROUP BY t.id, t.name, t.slug
        ORDER BY revenue DESC, t.name
      `;

      const fees = await this.prisma.raw.$queryRaw<Array<{ tenantId: string; fees: bigint | null }>>`
        SELECT e."tenantId" AS "tenantId", coalesce(sum(e."amountCents"), 0)::bigint AS fees
        FROM provider_earnings e
        WHERE e."earnedAt" >= date_trunc(${grain}, now()) - ${interval}::interval
          AND e.status <> 'VOID'
        GROUP BY 1
      `;
      const feeByTenant = new Map(fees.map((row) => [row.tenantId, Number(row.fees ?? 0)]));

      return rows.map((row) => {
        const revenueCents = Number(row.revenue ?? 0);
        const costOfGoodsCents = Number(row.cost ?? 0);
        const providerFeesCents = feeByTenant.get(row.tenantId) ?? 0;
        const orders = Number(row.orders);
        const profitCents = revenueCents - costOfGoodsCents - providerFeesCents;

        return {
          tenantId: row.tenantId,
          name: row.name,
          slug: row.slug,
          orders,
          revenueCents,
          costOfGoodsCents,
          providerFeesCents,
          profitCents,
          // Null rather than zero when there is no revenue: a margin on nothing
          // is not 0%, it is undefined, and a 0% badge invites the wrong read.
          marginPercent: revenueCents > 0 ? Math.round((profitCents / revenueCents) * 100) : null,
          pricedShare: orders ? Number(row.priced) / orders : 1,
        };
      });
    });
  }

  /**
   * Products priced in a way that loses money, and the ones not priced at all.
   *
   * Two faults with one consequence — an order that costs us more than it earns
   * — so they belong on one list. Both are silent in a total: an unpriced
   * product just makes the margin look worse, and a below-cost one makes volume
   * look like success. Neither announces itself.
   *
   * Below-cost is reported, not blocked. Selling under cost is sometimes a
   * deliberate decision, and a system that refuses it would just be worked
   * around; one that names it every time cannot be forgotten.
   */
  async pricingProblems() {
    const rows = await runWithoutTenantScope(() =>
      this.prisma.raw.pharmacyProduct.findMany({
        where: { isActive: true },
        orderBy: [{ pharmacy: { name: 'asc' } }, { medicationName: 'asc' }],
        select: {
          id: true,
          kitCode: true,
          medicationName: true,
          costOfGoodsCents: true,
          sellPriceCents: true,
          pharmacy: { select: { id: true, name: true } },
          pharmacyCategory: { select: { id: true, name: true } },
        },
      }),
    );

    return rows
      .map((row) => ({
        ...row,
        problem: problemWith(row),
        marginCents:
          row.sellPriceCents !== null && row.costOfGoodsCents !== null
            ? row.sellPriceCents - row.costOfGoodsCents
            : null,
      }))
      .filter((row) => row.problem !== null);
  }

  /** Bucket starts from the oldest in the window to now, inclusive. */
  private calendar(grain: Grain): string[] {
    const counts: Record<Grain, number> = { day: 30, week: 13, month: 12 };
    const now = new Date();
    const out: string[] = [];

    for (let back = counts[grain] - 1; back >= 0; back -= 1) {
      const at = new Date(now);
      if (grain === 'day') at.setUTCDate(at.getUTCDate() - back);
      if (grain === 'week') at.setUTCDate(at.getUTCDate() - back * 7);
      if (grain === 'month') at.setUTCMonth(at.getUTCMonth() - back);
      out.push(truncate(at, grain));
    }

    return out;
  }
}

/**
 * Postgres truncates weeks to Monday; the calendar has to agree or every bucket
 * misses its row by a few days and the chart reads as empty.
 */
function truncate(at: Date, grain: Grain): string {
  const copy = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (grain === 'month') copy.setUTCDate(1);
  if (grain === 'week') {
    const weekday = (copy.getUTCDay() + 6) % 7;
    copy.setUTCDate(copy.getUTCDate() - weekday);
  }
  return copy.toISOString().slice(0, 10);
}

function key(period: Date): string {
  return period.toISOString().slice(0, 10);
}

function todayKey(grain: Grain): string {
  return truncate(new Date(), grain);
}

function empty(period: string): Bucket {
  return {
    period,
    orders: 0,
    revenueCents: 0,
    costOfGoodsCents: 0,
    providerFeesCents: 0,
    profitCents: 0,
    patientPaidCents: 0,
    patientPricedShare: 1,
    pricedShare: 1,
  };
}

function total(buckets: Bucket[]): Bucket {
  const summed = buckets.reduce(
    (acc, bucket) => ({
      orders: acc.orders + bucket.orders,
      revenueCents: acc.revenueCents + bucket.revenueCents,
      costOfGoodsCents: acc.costOfGoodsCents + bucket.costOfGoodsCents,
      providerFeesCents: acc.providerFeesCents + bucket.providerFeesCents,
      patientPaidCents: acc.patientPaidCents + bucket.patientPaidCents,
      priced: acc.priced + bucket.orders * bucket.pricedShare,
      patientPriced: acc.patientPriced + bucket.orders * bucket.patientPricedShare,
    }),
    {
      orders: 0,
      revenueCents: 0,
      costOfGoodsCents: 0,
      providerFeesCents: 0,
      patientPaidCents: 0,
      priced: 0,
      patientPriced: 0,
    },
  );

  return {
    period: buckets[0]?.period ?? todayKey('month'),
    orders: summed.orders,
    revenueCents: summed.revenueCents,
    costOfGoodsCents: summed.costOfGoodsCents,
    providerFeesCents: summed.providerFeesCents,
    profitCents: summed.revenueCents - summed.costOfGoodsCents - summed.providerFeesCents,
    patientPaidCents: summed.patientPaidCents,
    patientPricedShare: summed.orders ? summed.patientPriced / summed.orders : 1,
    pricedShare: summed.orders ? summed.priced / summed.orders : 1,
  };
}

/** A total has no single period, and publishing one invites it to be plotted. */
function strip(bucket: Bucket) {
  const { period: _period, ...rest } = bucket;
  return {
    ...rest,
    marginPercent:
      rest.revenueCents > 0 ? Math.round((rest.profitCents / rest.revenueCents) * 100) : null,
  };
}

/** Why a product's pricing needs attention, or null when it does not. */
function problemWith(row: {
  sellPriceCents: number | null;
  costOfGoodsCents: number | null;
}): 'UNPRICED' | 'BELOW_COST' | 'COST_UNKNOWN' | null {
  if (row.sellPriceCents === null) return 'UNPRICED';
  // A price with no cost behind it is not a margin, it is a guess. Reported so
  // it is not silently counted as pure profit.
  if (row.costOfGoodsCents === null) return 'COST_UNKNOWN';
  if (row.sellPriceCents < row.costOfGoodsCents) return 'BELOW_COST';
  return null;
}
