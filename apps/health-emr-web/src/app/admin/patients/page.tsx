import { PatientList } from './list';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Patients — HealthEMR' };

export default function AdminPatientsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Patients"
        subtitle="Everyone who has completed one of your intake forms. Counts are your own — a patient who
          also buys from another business does not show that here."
      />
      <PatientList />
    </div>
  );
}
