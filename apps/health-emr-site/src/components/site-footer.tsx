import Link from 'next/link';
import { COMPANY } from '@/lib/site';

const COLUMNS = [
  {
    title: 'Platform',
    links: [
      { href: '/platform', label: 'How it works' },
      { href: '/security', label: 'Security and HIPAA' },
    ],
  },
  {
    title: 'Who it is for',
    links: [
      { href: '/for-telehealth', label: 'Telehealth brands' },
      { href: '/for-clinicians', label: 'Clinicians' },
      { href: '/for-pharmacies', label: 'Pharmacies' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { href: '/apply/telehealth', label: 'Book a demo' },
      { href: '/apply/clinician', label: 'Apply as a clinician' },
      { href: '/apply/pharmacy', label: 'Apply as a pharmacy' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line-soft)] bg-[var(--paper-tint)] px-6">
      <div className="mx-auto max-w-6xl py-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[var(--brand)] text-[0.68rem] font-semibold text-white"
              >
                H
              </span>
              <span className="text-[0.95rem] font-semibold">HealthEMR</span>
            </div>
            <p className="mt-4 max-w-xs text-[0.88rem] text-[var(--muted)]">
              Licensed clinical review, contracted pharmacies, and a patient
              record that holds up to an audit.
            </p>
            <address className="mt-4 text-[0.86rem] not-italic text-[var(--muted)]">
              {COMPANY.where}
            </address>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-[0.78rem] font-semibold text-[var(--ink)]">{column.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[0.88rem] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-[var(--line)] pt-8">
          {/* Said plainly rather than buried: somebody arriving from a search
              for "online prescription" needs to know what this is before they
              read anything else. */}
          <p className="max-w-4xl text-[0.8rem] leading-relaxed text-[var(--faint)]">
            HealthEMR is clinical operations software for licensed telehealth
            businesses. It does not provide medical advice and does not
            prescribe: every prescribing decision made on the platform is made
            by a clinician licensed in the patient’s own state.
          </p>
          <p className="mt-4 text-[0.8rem] text-[var(--faint)]">
            © {new Date().getFullYear()} HealthEMR · {COMPANY.where}
          </p>
        </div>
      </div>
    </footer>
  );
}
