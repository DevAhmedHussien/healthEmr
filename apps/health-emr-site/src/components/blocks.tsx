import Link from 'next/link';
import { clsx } from 'clsx';

/**
 * The pieces every page is built from.
 *
 * One idea per band, held in a lot of space. The temptation on a page like this
 * is to fill the room with cards; the reason not to is that the whole effect
 * depends on the reader finishing one thought before the next arrives.
 */

/** A full-width band. `tone` sets the ground, and dark grounds flip the text. */
export function Band({
  tone = 'paper',
  children,
  className,
  id,
  size = 'default',
}: {
  tone?: 'paper' | 'tint' | 'deep';
  children: React.ReactNode;
  className?: string;
  id?: string;
  size?: 'default' | 'tight' | 'tall';
}) {
  const dark = tone === 'deep';
  return (
    <section
      id={id}
      className={clsx(
        'px-6',
        size === 'tight' && 'py-14 md:py-20',
        size === 'default' && 'py-20 md:py-32',
        size === 'tall' && 'py-24 md:py-40',
        tone === 'paper' && 'bg-[var(--paper)]',
        tone === 'tint' && 'bg-[var(--paper-tint)]',
        dark && 'on-dark bg-[var(--deep)] text-white',
        className,
      )}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

/**
 * A section's heading.
 *
 * Centred by default, because at this scale a centred line is the one the eye
 * lands on first and the page is built around exactly one of them per band.
 */
export function SectionHead({
  eyebrow,
  title,
  lede,
  align = 'center',
  onDeep,
  as: Heading = 'h2',
  size = 'display',
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: 'left' | 'center';
  onDeep?: boolean;
  as?: 'h1' | 'h2' | 'h3';
  size?: 'hero' | 'display' | 'title';
}) {
  return (
    <div
      className={clsx(
        align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-xl',
      )}
    >
      {eyebrow ? (
        <p className={clsx('t-eyebrow', onDeep && 'text-[var(--brand-on-dark)]')}>{eyebrow}</p>
      ) : null}
      <Heading
        className={clsx(
          eyebrow && 'mt-3',
          size === 'hero' && 't-hero',
          size === 'display' && 't-display',
          size === 'title' && 't-title',
          onDeep && 'text-white',
        )}
      >
        {title}
      </Heading>
      {lede ? (
        <p
          className={clsx(
            't-lede mt-7',
            align === 'center' && 'mx-auto',
            onDeep && 'text-white/60',
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}

/** The primary action. Pill-shaped, the one saturated thing on the screen. */
export function Cta({
  href,
  children,
  variant = 'solid',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'solid' | 'quiet' | 'onDeep';
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'inline-flex items-center justify-center rounded-full px-6 py-3 text-[1rem] font-medium transition',
        variant === 'solid' && 'bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]',
        variant === 'quiet' &&
          'border border-[var(--line)] bg-transparent text-[var(--ink)] hover:border-[var(--ink)]',
        variant === 'onDeep' && 'bg-white text-[var(--deep)] hover:bg-white/90',
      )}
    >
      {children}
    </Link>
  );
}

/** A small blue "keep reading" link with a chevron. */
export function More({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="link-more">
      {children}
    </Link>
  );
}

/**
 * A large tile.
 *
 * Tiles carry one point each and are given real room — the rounded corner and
 * the padding are doing the work that a border would otherwise do, which is
 * what keeps a grid of them from reading as a table.
 */
export function Tile({
  title,
  body,
  eyebrow,
  tone = 'tint',
  children,
  className,
}: {
  title: string;
  body?: string;
  eyebrow?: string;
  tone?: 'tint' | 'paper' | 'deep';
  children?: React.ReactNode;
  className?: string;
}) {
  const dark = tone === 'deep';
  return (
    <div
      className={clsx(
        'flex flex-col overflow-hidden rounded-[var(--radius-xl)] p-8 md:p-10',
        tone === 'tint' && 'bg-[var(--paper-tint)]',
        tone === 'paper' && 'border border-[var(--line)] bg-[var(--paper)]',
        dark && 'on-dark bg-[var(--deep-tint)] text-white',
        className,
      )}
    >
      {eyebrow ? (
        <p className={clsx('t-eyebrow mb-2', dark && 'text-[var(--brand-on-dark)]')}>{eyebrow}</p>
      ) : null}
      <h3 className={clsx('t-title', dark && 'text-white')}>{title}</h3>
      {body ? (
        <p className={clsx('mt-3 text-[1rem]', dark ? 'text-white/60' : 'text-[var(--muted)]')}>
          {body}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** A grid of tiles. */
export function TileGrid({
  items,
  columns = 3,
  tone = 'tint',
}: {
  items: Array<{ title: string; body: string; eyebrow?: string }>;
  columns?: 2 | 3;
  tone?: 'tint' | 'paper' | 'deep';
}) {
  return (
    <div
      className={clsx(
        'mt-16 grid gap-4',
        columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {items.map((item) => (
        <Tile key={item.title} tone={tone} {...item} />
      ))}
    </div>
  );
}

/**
 * A numbered sequence, laid out as a single horizontal run.
 *
 * Numbered because these genuinely happen in order — a visit cannot ship before
 * it is signed. Numbering a list that is not a sequence is decoration.
 */
export function Steps({
  steps,
  onDeep,
}: {
  steps: Array<{ title: string; body: string }>;
  onDeep?: boolean;
}) {
  return (
    <ol className="mt-16 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
      {steps.map((step, index) => (
        <li key={step.title} className="relative">
          <div
            className={clsx(
              'flex h-10 w-10 items-center justify-center rounded-full text-[0.9rem] font-semibold tabular-nums',
              onDeep ? 'bg-white/10 text-white' : 'bg-[var(--ink)] text-white',
            )}
          >
            {index + 1}
          </div>
          <h3 className={clsx('mt-5 text-[1.15rem] font-semibold', onDeep && 'text-white')}>
            {step.title}
          </h3>
          <p
            className={clsx(
              'mt-2 text-[0.98rem]',
              onDeep ? 'text-white/60' : 'text-[var(--muted)]',
            )}
          >
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** A row of figures. Only used where the number means something specific. */
export function Figures({
  figures,
  onDeep,
}: {
  figures: Array<{ value: string; label: string }>;
  onDeep?: boolean;
}) {
  return (
    <dl className="mt-20 grid gap-10 border-t pt-12 sm:grid-cols-2 lg:grid-cols-4"
        style={{ borderColor: onDeep ? 'rgba(255,255,255,.12)' : 'var(--line)' }}>
      {figures.map((figure) => (
        <div key={figure.label}>
          <dt className="sr-only">{figure.label}</dt>
          <dd>
            <span
              className={clsx(
                'block text-[2.6rem] font-semibold leading-none tracking-[-0.03em] tabular-nums',
                onDeep ? 'text-white' : 'text-[var(--ink)]',
              )}
            >
              {figure.value}
            </span>
            <span
              className={clsx(
                'mt-3 block text-[0.95rem]',
                onDeep ? 'text-white/55' : 'text-[var(--muted)]',
              )}
            >
              {figure.label}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Prose on one side, a visual or panel on the other. */
export function Split({
  children,
  aside,
  reverse,
}: {
  children: React.ReactNode;
  aside: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div className={clsx(reverse && 'lg:order-2')}>{children}</div>
      <div className={clsx(reverse && 'lg:order-1')}>{aside}</div>
    </div>
  );
}

/** A definition list used inside a Split. */
export function Panel({
  title,
  items,
  onDeep,
}: {
  title?: string;
  items: Array<{ term: string; detail: string }>;
  onDeep?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-[var(--radius-xl)] p-8 md:p-10',
        onDeep ? 'bg-[var(--deep-tint)]' : 'bg-[var(--paper-tint)]',
      )}
    >
      {title ? (
        <h3
          className={clsx(
            'text-[0.78rem] font-semibold uppercase tracking-[0.1em]',
            onDeep ? 'text-white/45' : 'text-[var(--faint)]',
          )}
        >
          {title}
        </h3>
      ) : null}
      <dl className={clsx('space-y-5', title && 'mt-6')}>
        {items.map((item) => (
          <div
            key={item.term}
            className={clsx(
              'border-b pb-5 last:border-0 last:pb-0',
              onDeep ? 'border-white/10' : 'border-[var(--line)]',
            )}
          >
            <dt className={clsx('font-medium', onDeep && 'text-white')}>{item.term}</dt>
            <dd
              className={clsx(
                'mt-1.5 text-[0.95rem]',
                onDeep ? 'text-white/55' : 'text-[var(--muted)]',
              )}
            >
              {item.detail}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Frequently asked questions, as real disclosure elements.
 *
 * `<details>` rather than a JavaScript accordion: it is open to find-in-page,
 * it works before hydration, and a crawler reads the answer either way — which
 * is most of the reason questions are on a marketing page at all.
 */
export function Faq({ items, onDeep }: { items: Array<{ q: string; a: string }>; onDeep?: boolean }) {
  return (
    <div
      className={clsx(
        'mx-auto mt-14 max-w-3xl divide-y border-t border-b',
        onDeep ? 'divide-white/10 border-white/10' : 'divide-[var(--line)] border-[var(--line)]',
      )}
    >
      {items.map((item) => (
        <details key={item.q} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center gap-4 text-[1.05rem] font-medium">
            <span className="flex-1">{item.q}</span>
            <span
              aria-hidden
              className={clsx(
                'text-[1.4rem] font-light leading-none transition-transform duration-200 group-open:rotate-45',
                onDeep ? 'text-white/40' : 'text-[var(--faint)]',
              )}
            >
              +
            </span>
          </summary>
          <p
            className={clsx(
              'mt-3 max-w-2xl text-[1rem]',
              onDeep ? 'text-white/60' : 'text-[var(--muted)]',
            )}
          >
            {item.a}
          </p>
        </details>
      ))}
    </div>
  );
}

/** The closing band every page ends on. */
export function ClosingCta({
  title,
  lede,
  primary,
  secondary,
}: {
  title: string;
  lede: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <Band tone="deep" size="tall">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="t-display text-white">{title}</h2>
        <p className="t-lede mx-auto mt-6 max-w-xl text-white/60">{lede}</p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
          <Cta href={primary.href} variant="onDeep">
            {primary.label}
          </Cta>
          {secondary ? <More href={secondary.href}>{secondary.label}</More> : null}
        </div>
      </div>
    </Band>
  );
}

/**
 * Structured data.
 *
 * The prose says what we do to a person; this says it to a crawler in the
 * vocabulary it indexes. Kept beside the content it describes so the two get
 * edited together.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Our own content, not user input, and Next requires the raw form.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
