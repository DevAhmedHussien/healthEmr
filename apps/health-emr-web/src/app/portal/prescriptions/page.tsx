import { serverApi } from '@/lib/server-api';
import { Badge, Card, CardHeader, EmptyState, statusTone } from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/page-header';

interface Prescription {
  prescriptionId: string;
  medication: string;
  dose: string;
  quantity: string;
  refills: number;
  directions: string;
  status: string;
  signedAt: string;
  prescriber: string;
  licenseNumber: string;
  licenseState: string;
  shipment: { status: string; carrier: string | null; trackingNumber: string | null } | null;
}

export default async function MyPrescriptions() {
  const { data } = await serverApi<{ data: Prescription[] }>('v1/portal/prescriptions');

  return (
    <div className="space-y-6">
      <PageHeader title="Prescriptions" subtitle="Everything prescribed to you, and where it is." />

      {data.length === 0 ? (
        <Card>
          <EmptyState title="No prescriptions yet" hint="Approved prescriptions appear here." />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.map((prescription) => (
            <Card key={prescription.prescriptionId}>
              <CardHeader
                title={prescription.medication}
                subtitle={`${prescription.dose} · qty ${prescription.quantity} · ${prescription.refills} refills`}
                action={<Badge tone={statusTone(prescription.status)}>{prescription.status}</Badge>}
              />
              <p className="text-sm">{prescription.directions}</p>
              <p className="mt-3 text-xs text-[var(--ar-text-faint)]">
                Prescribed by {prescription.prescriber} · licence {prescription.licenseNumber} (
                {prescription.licenseState})
              </p>

              {prescription.shipment ? (
                <div className="mt-4 rounded-lg bg-[var(--ar-gray-50)] px-4 py-3 text-sm">
                  <span className="font-medium">{prescription.shipment.status}</span>
                  {prescription.shipment.trackingNumber ? (
                    <span className="text-[var(--ar-text-muted)]">
                      {' '}
                      · {prescription.shipment.carrier} {prescription.shipment.trackingNumber}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
