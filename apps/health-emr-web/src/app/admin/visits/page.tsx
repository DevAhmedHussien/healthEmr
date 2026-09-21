import { VisitList } from './list';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Visits — HealthEMR' };

export default function AdminVisitsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Visits"
        subtitle="Every intake your patients have submitted, each with one status covering the whole journey
          — from waiting on a clinician through to delivered."
      />
      <VisitList />
    </div>
  );
}
