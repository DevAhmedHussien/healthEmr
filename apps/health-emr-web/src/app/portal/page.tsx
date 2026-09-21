import { serverApi } from '@/lib/server-api';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/page-header';

interface Record_ {
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sexAtBirth: string;
  email: string;
  phone: string;
  address: { line1: string; city: string; state: string; postalCode: string };
  allergies: Array<{ substance: string; severity: string }>;
  conditions: Array<{ display: string }>;
  medications: Array<{ nameText: string }>;
}

export default async function MyHealth() {
  const record = await serverApi<Record_>('v1/portal/record');

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${record.firstName} ${record.lastName}`}
        subtitle={
          <>
            Record {record.mrn} · born {record.dateOfBirth}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Contact" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ar-text-muted)]">Email</dt>
              <dd>{record.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ar-text-muted)]">Phone</dt>
              <dd>{record.phone}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ar-text-muted)]">Address</dt>
              <dd className="text-right">
                {record.address.line1}
                <br />
                {record.address.city}, {record.address.state} {record.address.postalCode}
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Allergies" subtitle="As you reported them" />
          {record.allergies.length === 0 ? (
            <EmptyState title="None recorded" />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {record.allergies.map((allergy) => (
                <li key={allergy.substance} className="flex items-center justify-between gap-4">
                  <span>{allergy.substance}</span>
                  <span className="text-xs text-[var(--ar-text-faint)]">{allergy.severity}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Conditions" />
          {record.conditions.length === 0 ? (
            <EmptyState title="None recorded" />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {record.conditions.map((condition) => (
                <li key={condition.display}>{condition.display}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Medications" />
          {record.medications.length === 0 ? (
            <EmptyState title="None recorded" />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {record.medications.map((medication) => (
                <li key={medication.nameText}>{medication.nameText}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
