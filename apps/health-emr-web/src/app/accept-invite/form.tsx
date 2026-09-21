'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInviteSchema, type AcceptInviteInput } from '@health-emr/types';
import { Alert, Button } from '@/components/ui/primitives';
import { Form } from '@/components/form/form';
import { PasswordField } from '@/components/form/fields';
import { ShieldIcon } from '@/components/ui/icons';

export function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);

  if (!token) {
    return <Alert>That link is missing its invitation code. Use the link from your email.</Alert>;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          Your password is set. You can sign in as <strong>{done}</strong>.
        </Alert>
        <Link
          href="/login"
          className="inline-block rounded-[var(--ar-radius)] bg-[var(--ar-primary)] px-5 py-2.5 text-[0.9rem] font-medium text-white"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <Form<AcceptInviteInput>
      schema={acceptInviteSchema as never}
      defaultValues={{ token, password: '', confirmPassword: '' }}
      onSubmit={async (values) => {
        setBusy(true);
        setError(null);
        try {
          const response = await fetch('/api/bff/v1/auth/accept-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.message ?? 'That invitation is no longer valid');
          setDone(body.email);
          router.refresh();
        } catch (caught) {
          setError((caught as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <PasswordField<AcceptInviteInput>
          name="password"
          label="New password"
          autoComplete="new-password"
          hint="At least 12 characters — length matters more than symbols"
          required
        />
        <PasswordField<AcceptInviteInput>
          name="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          required
        />

        <Button type="submit" icon={ShieldIcon} disabled={busy} className="w-full">
          {busy ? 'Setting…' : 'Set password'}
        </Button>
      </div>
    </Form>
  );
}
