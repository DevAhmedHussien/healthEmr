import { PageHeader } from '@/components/ui/page-header';
import { SignaturePanel } from './signature-panel';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="My signature"
        subtitle="What goes on the prescriptions you sign. Drawn once, and kept encrypted."
      />
      <SignaturePanel />
    </div>
  );
}
