import { serverApi } from '@/lib/server-api';
import { Badge, Card, CardHeader, EmptyState, statusTone } from '@/components/ui/primitives';
import { formatDateShort } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';

interface Visit {
  visitId: string;
  category: string;
  status: string;
  submittedAt: string;
  decidedAt: string | null;
  items: Array<{ nameText: string; decision: string; decisionReason: string | null }>;
}

export default async function MyVisits() {
  const { data } = await serverApi<{ data: Visit[] }>('v1/portal/visits');

  return (
    <div className="space-y-6">
      <PageHeader
        title="My visits"
        subtitle="Questionnaires you have submitted and what a clinician decided."
      />

      {data.length === 0 ? (
        <Card>
          <EmptyState title="No visits yet" />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.map((visit) => (
            <Card key={visit.visitId}>
              <CardHeader
                title={visit.category}
                subtitle={`Submitted ${formatDateShort(visit.submittedAt)}`}
                action={
                  <Badge tone={statusTone(visit.status)}>{visit.status.replace(/_/g, ' ')}</Badge>
                }
              />
              <ul className="space-y-2 text-sm">
                {visit.items.map((item) => (
                  <li
                    key={item.nameText}
                    className="flex flex-wrap items-baseline justify-between gap-2"
                  >
                    <span>{item.nameText}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={statusTone(item.decision)}>{item.decision}</Badge>
                    </span>
                    {item.decisionReason ? (
                      <span className="w-full text-xs text-[var(--ar-text-muted)]">
                        {item.decisionReason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
