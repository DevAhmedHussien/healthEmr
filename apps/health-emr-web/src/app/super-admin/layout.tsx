import { RequireRole } from '@/components/portal/require-role';
import { Role } from '@health-emr/types';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RequireRole role={Role.SUPER_ADMIN}>{children}</RequireRole>;
}
