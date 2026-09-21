import { Badge, EmptyState } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';

export interface ActivityEntryView {
  id: string;
  sequence: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: { id: string; name: string; email: string; role: string } | null;
  tenant: { id: string; name: string } | null;
  changes: Array<{ field: string; from: unknown; to: unknown }> | null;
  ip: string | null;
  at: string;
}

const TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  ACCOUNT_SUSPENDED: 'danger',
  USER_DEACTIVATED: 'danger',
  PHI_DELETED: 'danger',
  BREAK_THE_GLASS: 'warning',
  LOGIN_FAILED: 'warning',
  ACCOUNT_REACTIVATED: 'success',
  APPLICATION_DECIDED: 'info',
  PRESCRIPTION_SIGNED: 'info',
};

function value(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—';
  if (Array.isArray(input)) return input.length ? input.join(', ') : 'none';
  if (typeof input === 'boolean') return input ? 'yes' : 'no';
  return String(input);
}

/**
 * The trail, as prose rather than as rows of enums.
 *
 * Each entry reads as a sentence with its field-level changes underneath, which
 * is the form somebody actually reviews. The sequence number is shown because a
 * gap in it is as much a signal as a bad hash.
 */
export function ActivityFeed({
  entries,
  dense = false,
}: {
  entries: ActivityEntryView[];
  dense?: boolean;
}) {
  if (!entries.length) {
    return (
      <EmptyState title="Nothing recorded yet" hint="Actions on this record will appear here." />
    );
  }

  return (
    <ol className="divide-y divide-[var(--ar-border)]">
      {entries.map((entry) => (
        <li key={entry.id} className={dense ? 'py-2.5' : 'py-3.5'}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Badge tone={TONE[entry.action] ?? 'neutral'}>
              {entry.action.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            <span className="text-[0.9rem] text-[var(--ar-body-color)]">{entry.summary}</span>
            <span className="ml-auto whitespace-nowrap text-[0.75rem] tabular-nums text-[var(--ar-text-faint)]">
              #{entry.sequence} · {formatDateTime(entry.at)}
            </span>
          </div>

          {entry.changes?.length ? (
            <ul className="mt-1.5 space-y-0.5 pl-1">
              {entry.changes.map((change) => (
                <li key={change.field} className="text-[0.78rem] text-[var(--ar-text-muted)]">
                  <span className="font-medium text-[var(--ar-body-color)]">{change.field}</span>
                  {': '}
                  <span className="line-through opacity-70">{value(change.from)}</span>
                  {' → '}
                  <span>{value(change.to)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {entry.actor || entry.tenant ? (
            <p className="mt-1 text-[0.72rem] text-[var(--ar-text-faint)]">
              {entry.actor ? `${entry.actor.email} · ${entry.actor.role.toLowerCase()}` : 'system'}
              {entry.tenant ? ` · ${entry.tenant.name}` : ''}
              {entry.ip ? ` · ${entry.ip}` : ''}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
