import { ChatPanel } from '@/components/chat/chat-panel';
import { PageHeader } from '@/components/ui/page-header';

export default function MessagesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        subtitle="Secure messages. Content is encrypted at rest and every read is recorded."
      />
      <ChatPanel />
    </div>
  );
}
