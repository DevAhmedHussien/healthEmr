import Link from 'next/link';
import { serverApi, swallow } from '@/lib/server-api';
import { Card, CardHeader, EmptyState, TableWrap } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/format';
import { DownloadIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Reports — HealthEMR' };

interface Report {
  kind: string;
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number>;
}

const REPORTS = [
  {
    kind: 'cost-of-goods',
    title: 'Cost of goods',
    blurb:
      'What each pharmacy’s fills cost us, taken from the price recorded when the order was dispatched.',
  },
  {
    kind: 'revenue',
    title: 'Revenue',
    blurb:
      'What each client business charged, counting only lines a clinician actually prescribed.',
  },
  {
    kind: 'provider-earnings',
    title: 'Provider earnings',
    blurb: 'What each clinician reviewed and what we owe them. Paid per review, not per approval.',
  },
  {
    kind: 'tenant-activity',
    title: 'Client activity',
    blurb: 'Volume by client business, with the provider fees attributable to each.',
  },
] as const;

/** Money columns, so a cents integer never renders as a raw number. */
const MONEY = /cents$/i;

function present(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (MONEY.test(key) && typeof value === 'number') return `$${(value / 100).toFixed(2)}`;
  if (key === 'coverage' && typeof value === 'number') return `${Math.round(value * 100)}%`;
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function label(key: string): string {
  return key
    .replace(/Cents$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

export default async function ReportsPage() {
  const reports = await Promise.all(
    REPORTS.map(async (report) => ({
      ...report,
      data: await serverApi<Report>(`v1/super-admin/reports/${report.kind}`).catch(swallow(null)),
    })),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="The platform’s books, four ways. Every cost figure publishes its coverage — the share of
          orders whose pharmacy had recorded a price — so a partial total is never read as exact.
          Each report exports as CSV."
      />

      {reports.map((report) => (
        <Card key={report.kind} className="p-0">
          <div className="p-6 pb-0">
            <CardHeader
              title={report.title}
              subtitle={report.blurb}
              action={
                <Link
                  href={`/api/bff/v1/super-admin/reports/${report.kind}?format=csv`}
                  className="inline-flex items-center gap-1.5 text-[0.8rem] font-medium"
                  prefetch={false}
                >
                  <DownloadIcon size={15} />
                  Export CSV
                </Link>
              }
            />
          </div>

          {!report.data || report.data.rows.length === 0 ? (
            <EmptyState
              title="Nothing to report yet"
              hint="Figures appear as the platform is used."
            />
          ) : (
            <>
              <TableWrap>
                <thead>
                  <tr>
                    {Object.keys(report.data.rows[0]).map((key) => (
                      <th key={key} scope="col">
                        {label(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row, index) => (
                    <tr key={index}>
                      {Object.entries(row).map(([key, value]) => (
                        <td
                          key={key}
                          className={typeof value === 'number' ? 'tabular-nums' : undefined}
                        >
                          {present(key, value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <div className="flex flex-wrap gap-x-8 gap-y-2 px-6 pb-6 pt-4">
                {Object.entries(report.data.totals).map(([key, value]) => (
                  <div key={key}>
                    <span className="block text-[0.72rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
                      {label(key)}
                    </span>
                    <span className="text-[1rem] font-medium tabular-nums text-[var(--ar-headings)]">
                      {present(key, value)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
