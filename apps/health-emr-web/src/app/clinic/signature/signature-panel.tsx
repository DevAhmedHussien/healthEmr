'use client';

import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { SignatureCard } from '@/components/clinic/signature-pad';

interface Signature {
  hasSignature: boolean;
  image: string | null;
  name: string | null;
  capturedAt: string | null;
}

export function SignaturePanel() {
  const [signature, setSignature] = React.useState<Signature | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setSignature(await api<Signature>('v1/clinic/me/signature'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not load your signature.');
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader
        title="Your signature"
        subtitle="Applied to every prescription you sign, alongside your name and the licence you held at that moment."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!signature ? (
        <div className="ar-skeleton h-44" />
      ) : (
        <>
          {!signature.hasSignature ? (
            <div className="mb-5">
              <Alert tone="warning">
                You cannot sign a prescription until this is done. It takes a moment.
              </Alert>
            </div>
          ) : null}

          <SignatureCard
            image={signature.image}
            name={signature.name}
            capturedAt={signature.capturedAt}
            onSave={async (next) => {
              await api('v1/clinic/me/signature', {
                method: 'PUT',
                body: JSON.stringify(next),
              });
              await load();
            }}
          />
        </>
      )}
    </Card>
  );
}
