import { MedicationCatalogue } from './list';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Medications — HealthEMR' };

export default function MedicationsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Medications"
        subtitle="Every product every pharmacy stocks, with the identifiers a client orders by and what each
          one costs and earns. Open a row to edit it in that pharmacy&rsquo;s own catalogue."
      />
      <MedicationCatalogue />
    </div>
  );
}
