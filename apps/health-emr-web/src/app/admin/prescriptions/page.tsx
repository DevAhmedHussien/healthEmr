import { PrescriptionList } from './list';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Prescriptions — HealthEMR' };

export default function AdminPrescriptionsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Prescriptions"
        subtitle="What a clinician actually signed, under which licence, and where the pharmacy has got to
          with it."
      />
      <PrescriptionList />
    </div>
  );
}
