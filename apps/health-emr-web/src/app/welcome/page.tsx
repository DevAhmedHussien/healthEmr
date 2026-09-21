import Link from 'next/link';

const STEPS = [
  {
    title: 'Your patient submits',
    body: 'You post the intake to our endpoint. We match the person or open a record.',
  },
  {
    title: 'We route to a licensed clinician',
    body: 'Only to a provider holding a current licence in the state the patient was in.',
  },
  {
    title: 'They approve, change or decline',
    body: 'Every line decided, with directions and a reason on the record.',
  },
  {
    title: 'The pharmacy fills and ships',
    body: 'Carrier and tracking captured; your customer is told automatically.',
  },
];

export default function Welcome() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16 md:py-24">
      <header className="flex items-center gap-2.5">
        <div className="bg-[var(--ar-primary)] grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold text-white">
          H
        </div>
        <span className="font-semibold">HealthEMR</span>
        <Link href="/login" className="ml-auto text-sm font-medium text-[var(--ar-primary)]">
          Sign in
        </Link>
      </header>

      <section className="mt-16 max-w-2xl">
        <h1 className="text-4xl font-medium leading-tight md:text-5xl">
          The clinical layer behind your telehealth brand.
        </h1>
        <p className="mt-5 text-lg text-[var(--ar-text-muted)]">
          Licensed providers, contracted pharmacies, and a patient record that holds up to an audit.
          You keep the storefront and the customer. We handle everything from intake to tracking
          number.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/apply/pharmacy"
            className="bg-[var(--ar-primary)] rounded-lg px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:brightness-105"
          >
            Apply as a pharmacy
          </Link>
          <Link
            href="/apply/provider"
            className="rounded-lg border border-[var(--ar-border)] bg-white px-5 py-3 text-sm font-medium transition hover:bg-[var(--ar-body-bg)]"
          >
            Apply as a provider
          </Link>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ar-text-faint)]">
          How a prescription moves
        </h2>
        <ol className="mt-6 grid gap-5 md:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="ar-card ar-card-pad p-5">
              <span className="text-xs font-semibold tabular-nums text-[var(--ar-primary)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-2 font-semibold">{step.title}</p>
              <p className="mt-1.5 text-sm text-[var(--ar-text-muted)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-24 border-t border-[var(--ar-border)] pt-8 text-sm text-[var(--ar-text-faint)]">
        HealthEMR — multi-tenant telehealth EMR.
      </footer>
    </div>
  );
}
