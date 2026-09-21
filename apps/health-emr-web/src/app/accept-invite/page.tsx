import { Suspense } from 'react';
import { AcceptInviteForm } from './form';

export const metadata = { title: 'Set your password — HealthEMR' };

export default function AcceptInvitePage() {
  return (
    <div className="grid min-h-screen place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-[var(--ar-radius-lg)] bg-[var(--ar-primary)] font-semibold text-white">
            H
          </div>
          <span className="text-[1.05rem] font-semibold">HealthEMR</span>
        </div>

        <h2 className="text-[1.4rem]">Set your password</h2>
        <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
          Your account was created for you, but nobody set a password on it — including us. Choose
          one now.
        </p>

        <div className="mt-7">
          <Suspense
            fallback={<div className="ar-skeleton h-64 w-full rounded-[var(--ar-radius-card)]" />}
          >
            <AcceptInviteForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
