'use client';

import type { PageInfo } from '@health-emr/types';
import { cn } from '@/lib/utils';
import { SimpleSelect } from '@/components/ui/select';

/**
 * Page numbers with ellipses, always showing first, last and a window around the
 * current page — so the control stays a fixed width whether there are 3 pages or
 * 300, and the row of numbers does not reflow as you page through.
 */
function pageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page));

  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  return sorted.flatMap((page, index) =>
    index > 0 && page - sorted[index - 1] > 1 ? ['…' as const, page] : [page],
  );
}

export function TablePagination({
  pageInfo,
  onPage,
  onPageSize,
}: {
  pageInfo: PageInfo;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { page, pageSize, total, totalPages } = pageInfo;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ar-border)] px-4 py-3"
    >
      <p className="text-[0.8rem] text-[var(--ar-text-muted)] tabular-nums">
        {total === 0 ? 'No entries' : `Showing ${first}–${last} of ${total}`}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[0.8rem] text-[var(--ar-text-muted)]">
          Rows
          <SimpleSelect
            value={String(pageSize)}
            onValueChange={(value) => onPageSize(Number(value))}
            className="w-auto min-w-[4.5rem] py-1 text-[0.8rem]"
            aria-label="Rows per page"
            options={[10, 25, 50, 100].map((size) => ({
              value: String(size),
              label: String(size),
            }))}
          />
        </label>

        <div className="flex items-center gap-1">
          <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Previous page">
            ‹
          </PageButton>

          {pageWindow(page, totalPages).map((entry, index) =>
            entry === '…' ? (
              <span key={`gap-${index}`} className="px-1 text-[var(--ar-text-faint)]">
                …
              </span>
            ) : (
              <PageButton
                key={entry}
                active={entry === page}
                onClick={() => onPage(entry)}
                label={`Page ${entry}`}
              >
                {entry}
              </PageButton>
            ),
          )}

          <PageButton
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            label="Next page"
          >
            ›
          </PageButton>
        </div>
      </div>
    </nav>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'grid h-8 min-w-8 place-items-center rounded-[var(--ar-radius)] px-2 text-[0.8rem] tabular-nums transition',
        active
          ? 'bg-[var(--ar-primary)] text-white'
          : 'text-[var(--ar-text-muted)] hover:bg-[var(--ar-body-bg)]',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
