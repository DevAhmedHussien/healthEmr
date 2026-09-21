'use client';

import * as React from 'react';
import { getSession, signIn } from 'next-auth/react';
import { ROLE_HOME_ROUTE, type Role } from '@health-emr/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Alert, Button } from '@/components/ui/primitives';
import { Form } from '@/components/form/form';
import { PasswordField, TextField } from '@/components/form/fields';
import { LogInIcon } from '@/components/ui/icons';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(1, 'Enter your password'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  return (
    <Form<LoginValues>
      schema={loginSchema}
      defaultValues={{ email: '', password: '' }}
      onSubmit={async (values) => {
        setBusy(true);
        setError(null);

        const result = await signIn('credentials', { ...values, redirect: false });

        if (result?.error) {
          // Deliberately does not distinguish an unknown email from a wrong
          // password — that difference is an account-enumeration oracle.
          setError('Email or password is incorrect');
          setBusy(false);
          return;
        }

        /**
         * Straight to the console, rather than to `/` and letting that redirect.
         *
         * Going via `/` meant two server round trips before anything rendered —
         * one to read the session and one to resolve the console's own layout —
         * and the screen was blank for both of them. Reading the role here and
         * navigating once removes a hop and the gap with it.
         *
         * `router.refresh()` is gone for the same reason: called immediately
         * after a push it re-renders the page being navigated away from.
         */
        const session = await getSession();
        const role = session?.user?.role as Role | undefined;
        const next = params.get('next');

        router.replace(next ?? (role ? ROLE_HOME_ROUTE[role] : '/'));
      }}
    >
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <TextField<LoginValues>
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          placeholder="you@clinic.com"
          required
        />

        <PasswordField<LoginValues>
          name="password"
          label="Password"
          autoComplete="current-password"
          required
        />

        <Button type="submit" icon={LogInIcon} disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>
    </Form>
  );
}
