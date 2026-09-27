import Link from 'next/link';
import { NAV } from '@/lib/site';

/**
 * The navigation is the audiences, named.
 *
 * Four different people read this site and want different things: a telehealth
 * business deciding whether to build on us, a clinician deciding whether to
 * take shifts, a pharmacy deciding whether to contract, and whoever has to sign
 * off that none of this is reckless. A single "Product" menu makes all four
 * translate; naming them means each finds their own page first.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[var(--paper)]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[52px] max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="HealthEMR home">
          <span
            aria-hidden
            className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[var(--brand)] text-[0.68rem] font-semibold text-white"
          >
            H
          </span>
          <span className="text-[0.95rem] font-semibold tracking-[-0.01em]">HealthEMR</span>
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-7 lg:flex">
          {NAV.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="text-[0.82rem] text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              {page.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-5 lg:ml-0">
          <a
            href="http://localhost:3005/login"
            className="hidden text-[0.82rem] text-[var(--muted)] transition-colors hover:text-[var(--ink)] sm:block"
          >
            Sign in
          </a>
          <Link
            href="/apply/telehealth"
            className="rounded-full bg-[var(--brand)] px-4 py-1.5 text-[0.82rem] font-medium text-white transition hover:bg-[var(--brand-hover)]"
          >
            Book a demo
          </Link>
        </div>
      </div>

      {/* Five links fit across a phone if they scroll. A drawer for five links
          is a tap that buys nothing. */}
      <nav
        aria-label="Main, condensed"
        className="flex gap-6 overflow-x-auto border-t border-[var(--line-soft)] px-6 py-2.5 lg:hidden"
      >
        {NAV.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className="whitespace-nowrap text-[0.8rem] text-[var(--muted)]"
          >
            {page.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
