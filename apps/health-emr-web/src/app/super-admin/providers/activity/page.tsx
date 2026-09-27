import { PageHeader } from '@/components/ui/page-header';
import { ActivityRoster } from './roster';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Clinician activity"
        subtitle="How long each clinician was actually working, and what they decided in that time."
      />
      <ActivityRoster />
    </div>
  );
}
