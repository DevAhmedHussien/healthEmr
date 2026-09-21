import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROLE_HOME_ROUTE, type Role } from '@health-emr/types';
import { PortalShell } from './portal-shell';

/**
 * Server-side gate for a route group.
 *
 * Runs before anything renders, so a signed-out or wrong-role visitor never
 * receives a byte of the page. The middleware does the same check earlier for
 * speed; this one is the guarantee, and the API enforces it a third time.
 */
export async function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) redirect('/login');
  if (session.user.role !== role) redirect(ROLE_HOME_ROUTE[session.user.role]);

  return (
    <PortalShell
      role={session.user.role}
      name={session.user.name ?? session.user.email ?? 'User'}
      email={session.user.email ?? ''}
    >
      {children}
    </PortalShell>
  );
}
