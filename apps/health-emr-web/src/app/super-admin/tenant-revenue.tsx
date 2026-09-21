import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import { Badge, Card, CardHeader, EmptyState, TableWrap } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMoney, formatNumber } from '@/lib/format';

interface Row {
  tenantId: string;
  name: string;
  slug: string;
  orders: number;
  revenueCents: number;
  costOfGoodsCents: number;
  providerFeesCents: number;
  profitCents: number;
  marginPercent: number | null;
  pricedShare: number;
}

/**
 * Which client accounts earn their keep.
 *
 * Clients that ordered nothing are listed rather than filtered out: an account
 * doing no volume is the most important row on this table, and dropping it
 * because its number is zero is how it goes unnoticed for a quarter.
 */
export async function TenantRevenue() {
  const rows = await serverApi<Row[]>('v1/super-admin/revenue/by-tenant?grain=month');

  return (
    <Card className="p-0">
      <div className="p-6 pb-0">
        <CardHeader
          title="By client account"
          subtitle="Last 12 months. Revenue is what we charge them; profit is what is left after the pharmacy and the clinician."
          action={
            <Link href="/super-admin/admins" className="text-[0.85rem] font-medium">
              Client accounts →
            </Link>
          }
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No client accounts yet" hint="Approve an application to add one." />
      ) : (
        <div className="px-6 pb-6">
          <TableWrap>
            <thead>
              <tr>
                <th>Account</th>
                <th>Medications</th>
                <th>Revenue</th>
                <th>Cost of goods</th>
                <th>Clinician fees</th>
                <th>Profit</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tenantId}>
                  <td>
                    <Link href={`/super-admin/admins/${row.tenantId}`} className="font-medium">
                      {row.name}
                    </Link>
                  </td>
                  <td className="tabular-nums">{formatNumber(row.orders)}</td>
                  <td className="tabular-nums">{formatMoney(row.revenueCents)}</td>
                  <td className="tabular-nums text-[var(--ar-text-muted)]">
                    {formatMoney(row.costOfGoodsCents)}
                  </td>
                  <td className="tabular-nums text-[var(--ar-text-muted)]">
                    {formatMoney(row.providerFeesCents)}
                  </td>
                  <td className="font-medium tabular-nums">{formatMoney(row.profitCents)}</td>
                  <td>
                    {row.marginPercent === null ? (
                      // Not 0%. A margin on no revenue is undefined, and a zero
                      // badge here reads as "we make nothing on them".
                      <span className="text-[var(--ar-text-faint)]">—</span>
                    ) : (
                      <Badge
                        tone={
                          row.marginPercent >= 40
                            ? 'success'
                            : row.marginPercent >= 15
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {row.marginPercent}%
                      </Badge>
                    )}
                    {row.pricedShare < 1 ? (
                      <Tooltip content="Some orders came from a product with no sell price, so this margin is understated.">
                        <span className="ml-1 text-[0.72rem] text-[var(--ar-on-warning)]">
                          incomplete
                        </span>
                      </Tooltip>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
    </Card>
  );
}
