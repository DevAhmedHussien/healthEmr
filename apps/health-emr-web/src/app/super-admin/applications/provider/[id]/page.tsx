import { serverApi } from '@/lib/server-api';
import {
  ApplicationReview,
  type ApplicationDetail,
} from '@/components/onboarding/application-review';
import { formatDateShort } from '@/lib/format';

interface ProviderApplication extends ApplicationDetail {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  credentials: string;
  npi: string;
  deaNumber: string | null;
  specialties: string[];
  yearsExperience: number | null;
  bio: string | null;
  requestedCategorySlugs: string[];
  createdAt: string;
}

export default async function ProviderApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await serverApi<ProviderApplication>(`v1/super-admin/onboarding/provider/${id}`);

  return (
    <ApplicationReview
      scope="provider"
      detail={detail}
      title={`${detail.firstName} ${detail.lastName}, ${detail.credentials}`}
      subtitle={`Applied ${formatDateShort(detail.createdAt)} · ${detail.email}`}
      fields={[
        { label: 'Email', value: detail.email },
        { label: 'Phone', value: detail.phone },
        {
          label: 'NPI',
          value: <span className="tabular-nums">{detail.npi}</span>,
        },
        { label: 'DEA', value: detail.deaNumber ?? '—' },
        { label: 'Specialties', value: detail.specialties.join(', ') || '—' },
        { label: 'Years in practice', value: detail.yearsExperience ?? '—' },
        {
          label: 'Categories requested',
          value: detail.requestedCategorySlugs.join(', ') || '—',
        },
        { label: 'Bio', value: detail.bio ?? '—' },
      ]}
    />
  );
}
