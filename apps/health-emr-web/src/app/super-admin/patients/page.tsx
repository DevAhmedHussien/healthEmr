import { PatientList } from './list';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Patients — HealthEMR' };

export default function PatientsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Patients"
        subtitle="Every patient across every account. The platform holds one record per person even when
          several client businesses have sent them — each tenant only ever sees its own link."
      />
      <PatientList />
    </div>
  );
}
