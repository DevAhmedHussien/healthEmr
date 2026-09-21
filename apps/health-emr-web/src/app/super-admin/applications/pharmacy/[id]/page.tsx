import { serverApi } from '@/lib/server-api';
import { Badge } from '@/components/ui/primitives';
import {
  ApplicationReview,
  type ApplicationDetail,
} from '@/components/onboarding/application-review';
import { formatDateShort } from '@/lib/format';

interface PharmacyApplication extends ApplicationDetail {
  legalName: string;
  tradingName: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  websiteUrl: string | null;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  statesServed: string[];
  categorySlugs: string[];
  integrationType: string;
  ncpdpId: string | null;
  npi: string | null;
  deaNumber: string | null;
  dispensesCompounded: boolean;
  dispensesBranded: boolean;
  isOutsourcingFacility: boolean;
  notes: string | null;
  createdAt: string;
}

export default async function PharmacyApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await serverApi<PharmacyApplication>(`v1/super-admin/onboarding/pharmacy/${id}`);

  return (
    <ApplicationReview
      scope="pharmacy"
      detail={detail}
      title={detail.legalName}
      subtitle={`Applied ${formatDateShort(detail.createdAt)} · ${detail.contactEmail}`}
      fields={[
        { label: 'Trading as', value: detail.tradingName ?? '—' },
        {
          label: 'Contact',
          value: `${detail.contactName} · ${detail.contactPhone}`,
        },
        { label: 'Website', value: detail.websiteUrl ?? '—' },
        {
          label: 'Address',
          value: `${detail.addressLine1}, ${detail.city}, ${detail.state} ${detail.postalCode}`,
        },
        { label: 'NCPDP', value: detail.ncpdpId ?? '—' },
        { label: 'NPI', value: detail.npi ?? '—' },
        { label: 'DEA', value: detail.deaNumber ?? '—' },
        {
          label: 'Integration',
          value: <Badge tone="primary">{detail.integrationType}</Badge>,
        },
        {
          label: 'Dispenses',
          value: (
            <span className="flex flex-wrap gap-1">
              {detail.dispensesCompounded ? <Badge tone="info">compounded</Badge> : null}
              {detail.dispensesBranded ? <Badge tone="info">branded</Badge> : null}
              {detail.isOutsourcingFacility ? <Badge tone="warning">503B facility</Badge> : null}
            </span>
          ),
        },
        { label: 'Categories', value: detail.categorySlugs.join(', ') || '—' },
        {
          label: 'Ships into',
          value: (
            <span className="flex flex-wrap gap-1">
              {detail.statesServed.map((state) => (
                <Badge key={state} tone="primary">
                  {state}
                </Badge>
              ))}
            </span>
          ),
        },
        { label: 'Notes', value: detail.notes ?? '—' },
      ]}
    />
  );
}
