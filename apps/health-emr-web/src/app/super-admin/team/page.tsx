import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Role } from '@health-emr/types';
import { PageHeader } from '@/components/ui/page-header';
import { Team } from './team';

export const dynamic = 'force-dynamic';

/**
 * Owner only, and checked here rather than relying on the nav not showing it.
 *
 * This is the one page in the console where the role is asked for exactly:
 * everywhere else an owner stands in for a super admin, but a super admin must
 * not stand in for an owner, or the division of authority would be one typed
 * URL deep.
 */
export default async function Page() {
  const session = await auth();
  if (session?.user?.role !== Role.OWNER) redirect('/super-admin');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Super admins"
        subtitle="Who administers the platform, and what each of them is allowed to do."
      />
      <Team />
    </div>
  );
}
