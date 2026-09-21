import { PharmacySettings } from './settings';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'My pharmacy — HealthEMR' };

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="My pharmacy"
        subtitle="Your details, and how prescriptions reach your own system."
      />
      <PharmacySettings />
    </div>
  );
}
