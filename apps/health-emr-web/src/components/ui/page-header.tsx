import * as React from 'react';

/**
 * The title block every page opens with.
 *
 * It existed on twenty pages as the same hand-written `<div><h2>…</h2><p>…</p></div>`,
 * which is how one of them ended up an `<h1>` at `font-bold tracking-tight`
 * while the rest were `<h2>` at the token weight. A heading that changes size
 * between two pages of the same console reads as two different products.
 *
 * `h2`, not `h1`: the shell already renders the page name as the document
 * heading, and two `h1`s on a page leave a screen reader with no outline.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  /** One sentence on what this page is for. Skip it when the title says it. */
  subtitle?: React.ReactNode;
  /** The page's primary control, if it has one. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2>{title}</h2>
        {subtitle ? (
          <p className="mt-1 max-w-[70ch] text-[0.9rem] text-[var(--ar-text-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-none items-center gap-2">{action}</div> : null}
    </div>
  );
}
