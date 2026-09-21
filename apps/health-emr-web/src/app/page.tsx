import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROLE_HOME_ROUTE } from '@health-emr/types';

/** Sends each role to its own home, or to the public site if signed out. */
export default async function Home() {
  const session = await auth();
  redirect(session?.user ? ROLE_HOME_ROUTE[session.user.role] : '/welcome');
}
