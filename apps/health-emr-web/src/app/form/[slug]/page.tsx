import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IntakeForm } from '@/app/intake/[tenant]/intake-form';
import { ArrowLeftIcon } from '@/components/ui/icons';
import { formFor } from '../slugs';

/** Which client business a bare `/form/…` link belongs to. */
const DEFAULT_TENANT = process.env.HOSTED_INTAKE_DEFAULT_TENANT ?? 'joeyMed';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = formFor(slug);
  return { title: form ? `${form.title} — start a visit` : 'Start a visit' };
}

/**
 * One category's intake form, at a link you can hand to a patient.
 *
 * `?company=` names the client business when a single deployment hosts forms
 * for several; without it the default is used, which is the common case.
 */
export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ company?: string }>;
}) {
  const { slug } = await params;
  const { company } = await searchParams;
  const form = formFor(slug);
  if (!form) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/form"
        className="inline-flex items-center gap-1.5 text-[0.82rem] font-medium text-[var(--ar-text-muted)]"
      >
        <ArrowLeftIcon size={14} />
        All forms
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="text-[1.6rem] font-semibold text-[var(--ar-headings)]">{form.title}</h1>
        <p className="mt-1.5 max-w-2xl text-[0.95rem] leading-relaxed text-[var(--ar-text-muted)]">
          {form.blurb} A licensed clinician reads everything you enter and decides whether treatment
          is right for you. There is no charge to be assessed.
        </p>
      </header>

      <IntakeForm tenant={company ?? DEFAULT_TENANT} visitType={form.visitType} />
    </main>
  );
}
