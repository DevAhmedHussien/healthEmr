import { ApiAccessPanel } from '@/components/integration/api-access-panel';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'API access — HealthEMR' };

export default function AdminIntegrationPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="API access"
        subtitle="What your backend sends us to submit a visit, and the keys that prove the visit is yours. Keys are issued and removed by the platform owner."
      />
      <ApiAccessPanel base="v1/admin" title="Your credentials" canIssue={false} />
    </div>
  );
}
