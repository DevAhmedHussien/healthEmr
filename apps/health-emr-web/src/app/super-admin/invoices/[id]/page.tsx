import Link from 'next/link';
import {
  AlertTriangleIcon,
  BarChartIcon,
  CheckCircleIcon,
  CreditCardIcon,
} from '@/components/ui/icons';
import { notFound } from 'next/navigation';
import { serverApi, swallow } from '@/lib/server-api';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  TableWrap,
  statusTone,
} from '@/components/ui/primitives';
import { Stat } from '@/components/ui/stat';
import { ActionDialog } from '@/components/admin/action-dialog';
import { ActivityFeed, type ActivityEntryView } from '@/components/admin/activity-feed';
import { formatDateShort, formatMoney } from '@/lib/format';

interface Invoice {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  costOfGoodsCents: number | null;
  source: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    contactEmail: string;
    billingPlan: string | null;
  };
  patient: { id: string; name: string; mrn: string };
  prescription: {
    id: string;
    signedAt: string;
    providerNameSnapshot: string;
    medication: { name: string; strength: string | null };
    orders: Array<{
      pharmacy: { name: string };
      costOfGoodsCents: number | null;
    }>;
  } | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  payments: Array<{
    id: string;
    processor: string;
    externalId: string | null;
    amountCents: number;
    status: string;
    paidAt: string | null;
  }>;
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [invoice, history] = await Promise.all([
    serverApi<Invoice>(`v1/super-admin/invoices/${id}`).catch(swallow(null)),
    serverApi<ActivityEntryView[]>(`v1/super-admin/activity/Invoice/${id}`).catch(swallow([] as ActivityEntryView[])),
  ]);
  if (!invoice) notFound();

  const margin =
    invoice.costOfGoodsCents === null ? null : invoice.totalCents - invoice.costOfGoodsCents;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/super-admin/invoices" className="text-[0.8rem] font-medium">
            ← Invoices
          </Link>
          <h2 className="mt-1 tabular-nums">{invoice.number}</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            <Link href={`/super-admin/admins/${invoice.tenant.id}`}>{invoice.tenant.name}</Link>
            {' · '}
            <Link href={`/super-admin/patients/${invoice.patient.id}`}>{invoice.patient.name}</Link>
            {' · '}
            <span className="tabular-nums">{invoice.patient.mrn}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(invoice.status)}>{invoice.status.toLowerCase()}</Badge>
          {invoice.status === 'DRAFT' ? (
            <ActionDialog
              label="Issue"
              icon="send"
              description={[
                'Sends this invoice out and fixes its contents.',
                'An issued invoice cannot be edited — correcting one means voiding it and raising another.',
              ]}
              path={`v1/super-admin/invoices/${invoice.id}/issue`}
              body={{ dueInDays: 30 }}
              requireReason={false}
              variant="primary"
              confirmLabel="Issue invoice"
              successMessage="Invoice issued."
            />
          ) : null}
          {invoice.status !== 'PAID' && invoice.status !== 'VOID' ? (
            <ActionDialog
              label="Void"
              icon="close"
              description={[
                'Marks this invoice as never owed.',
                'Refused once any payment has settled it — refund instead.',
              ]}
              path={`v1/super-admin/invoices/${invoice.id}/void`}
              variant="danger"
              confirmLabel="Void invoice"
              successMessage="Invoice voided."
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total"
          icon={CreditCardIcon}
          value={formatMoney(invoice.totalCents)}
          sub={invoice.currency}
          tone="primary"
        />
        <Stat
          label="Paid"
          icon={CheckCircleIcon}
          value={formatMoney(invoice.paidCents)}
          sub={`${invoice.payments.length} payments`}
          tone="success"
        />
        <Stat
          label="Outstanding"
          icon={AlertTriangleIcon}
          value={formatMoney(invoice.outstandingCents)}
          sub={invoice.dueAt ? `due ${formatDateShort(invoice.dueAt)}` : 'not issued'}
          tone={invoice.outstandingCents > 0 ? 'warning' : 'success'}
        />
        <Stat
          label="Margin on this fill"
          icon={BarChartIcon}
          value={margin === null ? '—' : formatMoney(margin)}
          sub={
            invoice.costOfGoodsCents === null
              ? 'pharmacy had not priced it'
              : `cost ${formatMoney(invoice.costOfGoodsCents)}`
          }
          tone={margin === null ? 'primary' : margin >= 0 ? 'success' : 'danger'}
        />
      </div>

      <Card className="p-0">
        <div className="p-6 pb-0">
          <CardHeader title="Lines" subtitle="What is being charged for." />
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td className="tabular-nums">{line.quantity}</td>
                <td className="tabular-nums">{formatMoney(line.unitPriceCents)}</td>
                <td className="tabular-nums">{formatMoney(line.totalCents)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="text-right font-medium">
                Total
              </td>
              <td className="font-medium tabular-nums">{formatMoney(invoice.totalCents)}</td>
            </tr>
          </tbody>
        </TableWrap>
      </Card>

      {invoice.prescription ? (
        <Card>
          <CardHeader
            title="What it is for"
            subtitle="The prescription this invoice was raised from."
          />
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Detail term="Medication" value={`${invoice.prescription.medication.name}`} />
            <Detail term="Prescriber" value={invoice.prescription.providerNameSnapshot} />
            <Detail term="Signed" value={formatDateShort(invoice.prescription.signedAt)} />
            <Detail
              term="Filled by"
              value={invoice.prescription.orders[0]?.pharmacy.name ?? 'not yet dispatched'}
            />
          </dl>
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="p-6 pb-0">
          <CardHeader title="Payments" subtitle="Money received against this invoice." />
        </div>
        {invoice.payments.length === 0 ? (
          <EmptyState title="No payments recorded" hint="Record one when the money arrives." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">Amount</th>
                <th scope="col">Processor</th>
                <th scope="col">Reference</th>
                <th scope="col">Status</th>
                <th scope="col">Paid</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="tabular-nums font-medium">{formatMoney(payment.amountCents)}</td>
                  <td>{payment.processor}</td>
                  <td className="text-[0.8rem] text-[var(--ar-text-faint)]">
                    {payment.externalId ?? '—'}
                  </td>
                  <td>
                    <Badge tone={statusTone(payment.status)}>{payment.status.toLowerCase()}</Badge>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {payment.paidAt ? formatDateShort(payment.paidAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader title="History" subtitle="Everything that has happened to this invoice." />
        <ActivityFeed entries={history} dense />
      </Card>
    </div>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
        {term}
      </dt>
      <dd className="mt-0.5 text-[0.9rem] text-[var(--ar-body-color)]">{value}</dd>
    </div>
  );
}
