import { AdminAccounts } from './accounts';
import { PageHeader } from '@/components/ui/page-header';
export const metadata = { title: 'Admin accounts — HealthEMR' };

export default function AdminsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin accounts"
        subtitle="The telehealth businesses using the platform. Creating one sends an invite — you never set
          anyone&rsquo;s password."
      />
      <AdminAccounts />
    </div>
  );
}
