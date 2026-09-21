import { InvoiceList } from './list';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Invoices — HealthEMR' };

export default function InvoicesPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        subtitle="Billing across every client business. An invoice is built from what actually happened —
          the prescription, the price the client quoted, the pharmacy that filled it — and becomes
          immutable once issued."
      />
      <InvoiceList />
    </div>
  );
}
