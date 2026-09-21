import { QueueTable } from './queue-table';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Fill queue — HealthEMR' };

export default function FillQueuePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Fill queue"
        subtitle="Everything waiting to be dispensed. Search by anything on the row — medication, patient,
          record number, tracking number, the order id your system gave it, the prescriber, even the
          city — and record a shipment or raise an issue without leaving it."
      />
      <QueueTable />
    </div>
  );
}
