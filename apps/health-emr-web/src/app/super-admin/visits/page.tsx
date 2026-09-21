import { VisitList } from './list';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Visits — HealthEMR' };

export default function SuperAdminVisitsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Visits"
        subtitle="Every visit on the platform, whoever sent it — who the patient is, which client they came
          from, and how far it got."
      />
      <VisitList />
    </div>
  );
}
