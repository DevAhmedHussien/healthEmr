import { ApplicationsInbox } from './inbox';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Applications — HealthEMR' };

export default function ApplicationsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Applications"
        subtitle="Pharmacies and clinicians asking to join. A provider licence gates routing, so nothing is
          approved until a person has checked the document behind it."
      />
      <ApplicationsInbox />
    </div>
  );
}
