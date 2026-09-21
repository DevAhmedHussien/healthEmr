import { VISIT_TYPES } from '@health-emr/types';
import { IntakeForm } from './intake-form';

export const metadata = { title: 'Start a visit' };

/**
 * A client business's hosted intake form.
 *
 * `/intake/{company}?visit={visitType}` — the same two identifiers a client
 * already sends on the API, so a link can be handed to a patient without
 * anything new being configured beyond the key this form posts with.
 */
export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ visit?: string }>;
}) {
  const { tenant } = await params;
  const { visit } = await searchParams;

  const visitType = VISIT_TYPES.includes(visit as never) ? (visit as string) : 'weightloss';

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-[1.6rem] font-semibold text-[var(--ar-headings)]">Start a visit</h1>
        <p className="mt-1.5 max-w-2xl text-[0.95rem] leading-relaxed text-[var(--ar-text-muted)]">
          A licensed clinician reads everything you enter here and decides whether treatment is
          right for you. It takes a few minutes, and there is no charge to be assessed.
        </p>
      </header>

      <IntakeForm tenant={tenant} visitType={visitType} />
    </main>
  );
}
