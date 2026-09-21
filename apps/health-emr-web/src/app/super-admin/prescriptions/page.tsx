import { PrescriptionList } from './list';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Prescriptions — HealthEMR' };

export default function PrescriptionsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Prescriptions"
        subtitle="Every prescription written on the platform, with the licence it was signed under and where
          it shipped."
      />
      <PrescriptionList />
    </div>
  );
}
