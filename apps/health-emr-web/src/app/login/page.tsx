import { Suspense } from 'react';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in — HealthEMR' };

const POINTS = [
  [
    'Licensed routing',
    'A visit only ever reaches a clinician licensed in the patient’s own state.',
  ],
  [
    'One record per person',
    'Deduplicated across every client business, so nobody prescribes blind.',
  ],
  ['Audited end to end', 'Every read and every decision, hash-chained and retained for six years.'],
];

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel. Hidden on small screens, where it would just push the
          form below the fold. */}
      <aside className="relative hidden overflow-hidden bg-[var(--ar-primary)] p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-white/5"
        />

        <div className="relative flex items-center gap-2.5 text-white">
          <div className="grid h-10 w-10 place-items-center rounded-[var(--ar-radius-lg)] bg-white/15 font-semibold">
            H
          </div>
          <span className="text-[1.1rem] font-semibold">HealthEMR</span>
        </div>

        <div className="relative max-w-md text-white">
          <h1 className="text-[2rem] font-semibold leading-snug text-white">
            The clinical layer behind your telehealth brand.
          </h1>
          <ul className="mt-8 space-y-5">
            {POINTS.map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-white/70"
                />
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="block text-[0.9rem] text-white/75">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[0.78rem] text-white/50">
          Protected health information. Authorised access only.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-[var(--ar-radius-lg)] bg-[var(--ar-primary)] font-semibold text-white">
              H
            </div>
            <span className="text-[1.05rem] font-semibold">HealthEMR</span>
          </div>

          <h2 className="text-[1.4rem]">Welcome back</h2>
          <p className="mt-1 text-[0.9rem] text-[var(--ar-text-muted)]">
            Sign in to continue to your portal.
          </p>

          <div className="mt-7">
            {/* useSearchParams opts its subtree out of prerendering, so it is
                isolated rather than bailing the whole page. */}
            <Suspense
              fallback={<div className="ar-skeleton h-64 w-full rounded-[var(--ar-radius-card)]" />}
            >
              <LoginForm />
            </Suspense>
          </div>

          <div className="mt-8 space-y-3 border-t border-[var(--ar-border)] pt-6 text-[0.82rem] text-[var(--ar-text-muted)]">
            <p>Sessions end after 15 minutes of inactivity.</p>
            <p>
              Want to work with us?{' '}
              <Link href="/apply/provider" className="font-medium">
                Apply as a provider
              </Link>
              {' or '}
              <Link href="/apply/pharmacy" className="font-medium">
                as a pharmacy
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
