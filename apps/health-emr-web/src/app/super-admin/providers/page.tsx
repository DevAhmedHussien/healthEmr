import { ProviderDirectory } from './directory';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Providers — HealthEMR' };

export default function ProvidersPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Providers"
        subtitle="The approved roster. Counts are computed in the database, once per page."
      />
      <ProviderDirectory />
    </div>
  );
}
