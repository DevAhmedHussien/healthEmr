import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { serverApi, swallow } from '@/lib/server-api';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { ROLE_LABEL } from '@/components/portal/nav';
import { PortalShell } from '@/components/portal/portal-shell';
import { formatDateShort } from '@/lib/format';
import type { Role } from '@health-emr/types';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'My details — HealthEMR' };

interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  phone: string | null;
  isEmailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  tenant: { name: string } | null;
}

/**
 * Your own record.
 *
 * Reached from the top bar rather than the sidebar, because it is about the
 * person signed in rather than the work they are here to do. Read-only for now:
 * a name on an account is what a prescription is signed with, so changing one is
 * an administrative act rather than a preference.
 */
export default async function ProfilePage() {
  const session = await auth();
  const user = session?.user as { role?: Role; name?: string; email?: string } | undefined;
  if (!user?.role) redirect('/login');

  const me = await serverApi<Me>('v1/auth/profile').catch(swallow(null));

  return (
    <PortalShell role={user.role} name={user.name ?? ''} email={user.email ?? ''}>
      <div className="space-y-5">
        <PageHeader
          title="My details"
          subtitle="What this platform holds about you, and how you sign in."
        />

        <Card>
          <CardHeader title="Account" subtitle="Ask the platform owner to change any of this." />
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            <Detail
              term="Name"
              value={me ? `${me.firstName} ${me.lastName}` : (user.name ?? '—')}
            />
            <Detail term="Email" value={me?.email ?? user.email ?? '—'} />
            <Detail term="Phone" value={me?.phone ?? '—'} />
            <Detail term="Role" value={ROLE_LABEL[user.role]} />
            <Detail term="Organisation" value={me?.tenant?.name ?? 'The platform'} />
            <Detail
              term="Member since"
              value={me?.createdAt ? formatDateShort(me.createdAt) : '—'}
            />
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--ar-border-soft)] pt-4">
            <Badge tone={me?.isEmailVerified ? 'success' : 'warning'}>
              {me?.isEmailVerified ? 'email verified' : 'email not verified'}
            </Badge>
            {me?.lastLoginAt ? (
              <span className="text-[0.78rem] text-[var(--ar-text-faint)]">
                Last signed in {formatDateShort(me.lastLoginAt)}
              </span>
            ) : null}
          </div>
        </Card>
      </div>
    </PortalShell>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
        {term}
      </dt>
      <dd className="mt-0.5 break-words text-[0.9rem] text-[var(--ar-body-color)]">{value}</dd>
    </div>
  );
}
