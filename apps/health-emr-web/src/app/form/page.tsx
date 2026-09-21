import Link from 'next/link';
import { Badge, Card } from '@/components/ui/primitives';
import { ArrowRightIcon } from '@/components/ui/icons';
import { FORMS } from './slugs';

export const metadata = { title: 'Intake forms' };

const DEFAULT_TENANT = process.env.HOSTED_INTAKE_DEFAULT_TENANT ?? 'joeyMed';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Every intake form, and whether it is actually live.
 *
 * A form whose category the client business is not entitled to would render and
 * then fail on submit, which is a worse experience than not offering it — so the
 * ones that cannot be used say so here.
 */
async function enabled(): Promise<Set<string>> {
  const key =
    process.env[`HOSTED_INTAKE_KEY_${DEFAULT_TENANT.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`];
  if (!key) return new Set();

  const checks = await Promise.all(
    FORMS.map(async (form) => {
      const response = await fetch(`${API}/partner/v1/questionnaire/${form.visitType}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
      }).catch(() => null);
      if (!response?.ok) return null;
      const payload = await response.json().catch(() => null);
      return payload?.status === 200 ? form.visitType : null;
    }),
  );

  return new Set(checks.filter(Boolean) as string[]);
}

export default async function FormsIndex() {
  const live = await enabled();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-[1.6rem] font-semibold text-[var(--ar-headings)]">Intake forms</h1>
        <p className="mt-1.5 max-w-2xl text-[0.95rem] leading-relaxed text-[var(--ar-text-muted)]">
          One per treatment. Each asks that category&rsquo;s own questions, collects an ID where the
          category needs one, and submits a visit for a clinician to review.
        </p>
        <p className="mt-2 text-[0.82rem] text-[var(--ar-text-faint)]">
          Submitting as <code>{DEFAULT_TENANT}</code>. Add <code>?company=slug</code> to submit as a
          different client business.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {FORMS.map((form) => {
          const available = live.has(form.visitType);
          const card = (
            <Card className="h-full transition hover:shadow-[0_6px_20px_rgba(34,48,62,0.12)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--ar-headings)]">{form.title}</p>
                  <p className="mt-1 text-[0.82rem] leading-relaxed text-[var(--ar-text-muted)]">
                    {form.blurb}
                  </p>
                  <p className="mt-2 text-[0.72rem] tabular-nums text-[var(--ar-text-faint)]">
                    /form/{form.slug} · {form.visitType}
                  </p>
                </div>
                {available ? (
                  <ArrowRightIcon size={16} className="mt-1 flex-none text-[var(--ar-primary)]" />
                ) : (
                  <Badge tone="neutral">not enabled</Badge>
                )}
              </div>
            </Card>
          );

          return available ? (
            <Link key={form.slug} href={`/form/${form.slug}`} className="block no-underline">
              {card}
            </Link>
          ) : (
            <div key={form.slug} className="opacity-60">
              {card}
            </div>
          );
        })}
      </div>
    </main>
  );
}
