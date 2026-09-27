import { serverApi } from '@/lib/server-api';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  TableWrap,
  statusTone,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/page-header';
import { AddLicence } from '@/components/admin/licence-editor';
import { formatDateShort } from '@/lib/format';

interface Licence {
  id: string;
  state: string;
  licenseNumber: string;
  status: string;
  issuedAt: string | null;
  expiresAt: string;
}

export const dynamic = 'force-dynamic';

/**
 * The states a clinician is licensed in, from their own side.
 *
 * They find out first when a new licence comes through, so they can add it
 * here rather than emailing somebody. What they cannot do is make it count:
 * it arrives pending, and visits are routed only on a licence the platform has
 * checked. The page says so plainly, because a row that looks added but sends
 * no work is otherwise indistinguishable from a bug.
 */
export default async function Page() {
  const { data: licences } = await serverApi<{ data: Licence[] }>('v1/clinic/me/licences');

  const now = Date.now();
  const expiring = licences.filter((licence) => {
    const days = (new Date(licence.expiresAt).getTime() - now) / 86_400_000;
    return licence.status === 'ACTIVE' && days > 0 && days <= 60;
  });
  const pending = licences.filter((licence) => licence.status === 'PENDING');

  return (
    <div className="space-y-5">
      <PageHeader
        title="My licences"
        subtitle="The states you can be sent visits in. We route a visit only to a clinician holding a current licence in the patient's state."
      />

      {pending.length ? (
        <Card>
          <CardHeader
            title={`${pending.length} waiting to be checked`}
            subtitle={`${pending
              .map((licence) => licence.state)
              .join(
                ', ',
              )} — added but not yet used to route visits. We verify these against the state board.`}
          />
        </Card>
      ) : null}

      {expiring.length ? (
        <Card>
          <CardHeader
            title={`${expiring.length} expiring within 60 days`}
            subtitle={`${expiring
              .map((licence) => `${licence.state} on ${formatDateShort(licence.expiresAt)}`)
              .join(', ')}. Visits stop routing to you in that state on the expiry date.`}
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="State licences"
          subtitle={`${licences.length} on file`}
          action={<AddLicence held={licences.map((licence) => licence.state)} scope="self" />}
        />

        {licences.length === 0 ? (
          <EmptyState
            title="No licences on file"
            hint="Add the states you are licensed in and we will check them."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>State</th>
                <th>Number</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {licences.map((licence) => {
                const lapsed = new Date(licence.expiresAt) < new Date();
                return (
                  <tr key={licence.id}>
                    <td className="font-medium">{licence.state}</td>
                    <td className="tabular-nums">{licence.licenseNumber}</td>
                    <td className="tabular-nums">{formatDateShort(licence.expiresAt)}</td>
                    <td>
                      <Badge tone={lapsed ? 'danger' : statusTone(licence.status)}>
                        {lapsed ? 'expired' : licence.status.toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
