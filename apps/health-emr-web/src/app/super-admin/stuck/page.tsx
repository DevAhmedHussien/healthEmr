import { StuckOrders } from './stuck';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Stuck orders — HealthEMR' };

export default function StuckPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Stuck orders"
        subtitle="Prescriptions that were signed but never reached a pharmacy&rsquo;s system — a failed
          transmission, or a pharmacy with no working connection. Nothing else surfaces these: the
          client sees an approved visit and the patient sees nothing at all."
      />
      <StuckOrders />
    </div>
  );
}
