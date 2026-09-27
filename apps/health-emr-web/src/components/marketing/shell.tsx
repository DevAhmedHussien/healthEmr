import Link from 'next/link';

/**
 * The public site's frame.
 *
 * Four audiences read these pages and want different things: a telehealth
 * business deciding whether to build on us, a clinician deciding whether to
 * take shifts, a pharmacy deciding whether to contract, and a compliance
 * officer checking we are not reckless. The navigation is those four, named
 * plainly, rather than a single "Product" menu they each have to translate.
 */
const NAV = [
  { href: '/platform', label: 'How it works' },
  { href: '/for-brands', label: 'For telehealth brands' },
  { href: '/for-clinicians', label: 'For clinicians' },
  { href: '/for-pharmacies', label: 'For pharmacies' },
  { href: '/security', label: 'Security' },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--ar-body-bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--ar-border-soft)] bg-[var(--ar-card-bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
          <Link href="/welcome" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--ar-primary)] text-sm font-semibold text-white">
              H
            </span>
            <span className="font-semibold">HealthEMR</span>
          </Link>

          <nav className="hidden flex-1 items-center gap-5 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[0.86rem] text-[var(--ar-text-muted)] transition hover:text-[var(--ar-primary)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            <Link
              href="/login"
              className="text-[0.86rem] font-medium text-[var(--ar-text-muted)] transition hover:text-[var(--ar-primary)]"
            >
              Sign in
            </Link>
            <Link
              href="/for-brands#start"
              className="rounded-[var(--ar-radius)] bg-[var(--ar-primary)] px-3.5 py-2 text-[0.84rem] font-medium text-white transition hover:brightness-105"
            >
              Talk to us
            </Link>
          </div>
        </div>

        {/* On narrow screens the nav moves below the logo rather than behind a
            menu button: five links fit, and a drawer for five links is a tap
            that buys nothing. */}
        <nav className="flex gap-4 overflow-x-auto border-t border-[var(--ar-border-soft)] px-5 py-2 lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap text-[0.8rem] text-[var(--ar-text-muted)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main>{children}</main>

      <footer className="mt-24 border-t border-[var(--ar-border-soft)] bg-[var(--ar-card-bg)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--ar-primary)] text-sm font-semibold text-white">
                H
              </span>
              <span className="font-semibold">HealthEMR</span>
            </div>
            <p className="mt-3 max-w-xs text-[0.84rem] text-[var(--ar-text-muted)]">
              The clinical layer behind your telehealth brand — licensed review,
              pharmacy fulfilment and a record that holds up to an audit.
            </p>
          </div>

          <FooterColumn
            title="Platform"
            links={[
              { href: '/platform', label: 'How it works' },
              { href: '/security', label: 'Security and HIPAA' },
            ]}
          />
          <FooterColumn
            title="Work with us"
            links={[
              { href: '/for-brands', label: 'Telehealth brands' },
              { href: '/for-clinicians', label: 'Clinicians' },
              { href: '/for-pharmacies', label: 'Pharmacies' },
            ]}
          />
          <FooterColumn
            title="Apply"
            links={[
              { href: '/apply/provider', label: 'Join as a clinician' },
              { href: '/apply/pharmacy', label: 'Join as a pharmacy' },
              { href: '/login', label: 'Sign in' },
            ]}
          />
        </div>

        <div className="border-t border-[var(--ar-border-soft)] px-5 py-5">
          <p className="mx-auto max-w-6xl text-[0.78rem] text-[var(--ar-text-faint)]">
            HealthEMR is a clinical operations platform for licensed telehealth.
            It does not provide medical advice; every prescribing decision on it
            is made by a licensed clinician.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--ar-text-faint)]">
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-[0.86rem] text-[var(--ar-text-muted)] transition hover:text-[var(--ar-primary)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
