import { PharmacyDirectory } from './directory';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Pharmacies — HealthEMR' };

export default function PharmaciesPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Pharmacies"
        subtitle="Dispensing partners, their catalogue size and how quickly they ship."
      />
      <PharmacyDirectory />
    </div>
  );
}
