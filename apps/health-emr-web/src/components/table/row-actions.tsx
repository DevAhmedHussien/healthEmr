'use client';

import * as React from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import {
  ArchiveIcon,
  EditIcon,
  MoreIcon,
  RestoreIcon,
  TrashIcon,
} from '@/components/ui/icons';

/**
 * The actions on a row, in one place.
 *
 * Every table that had them built its own: different icon order, a header that
 * was sometimes "Actions" and sometimes blank, tooltips on some and not
 * others. Which is fine until somebody uses two of those tables in a day and
 * has to relearn the column — so the order is fixed here (edit, then the
 * reversible thing, then the irreversible one), the header is the same word
 * everywhere, and there is exactly one implementation to fix when one of them
 * is wrong.
 *
 * Two states are deliberately different and often confused. An action the
 * signed-in administrator has not been granted is *absent* — a disabled
 * control invites a conversation about why, and the answer is not something
 * they can do anything about from here. An action they may take but cannot
 * take *on this row* is disabled and says why: they can act on that, either by
 * picking a different row or by doing the thing the reason names.
 */

export type RowActionKind = 'edit' | 'archive' | 'restore' | 'delete';

export interface RowAction {
  kind: RowActionKind;
  /** Reads as a command on the tooltip and to a screen reader: "Archive Acme Health". */
  label: string;
  onSelect: () => void;
  /**
   * Why this cannot be done to this row, from the API rather than guessed
   * here. Present means the control is shown disabled carrying this sentence.
   */
  blockedReason?: string | null;
  /** Absent entirely when the administrator has not been granted it. */
  permitted?: boolean;
}

const ICONS: Record<RowActionKind, typeof EditIcon> = {
  edit: EditIcon,
  archive: ArchiveIcon,
  restore: RestoreIcon,
  delete: TrashIcon,
};

/** Fixed, so the same gesture means the same thing in every table. */
const ORDER: RowActionKind[] = ['edit', 'archive', 'restore', 'delete'];

export function RowActions({ actions }: { actions: RowAction[] }) {
  const shown = ORDER.flatMap((kind) =>
    actions.filter((action) => action.kind === kind && action.permitted !== false),
  );

  if (!shown.length) return <span className="text-[var(--ar-text-faint)]">—</span>;

  return (
    <div className="flex items-center justify-end gap-1">
      {/* The icons themselves, once there is room for them. */}
      <div className="hidden items-center gap-1 sm:flex">
        {shown.map((action) => (
          <ActionButton key={action.kind} action={action} />
        ))}
      </div>

      {/* And collapsed, when there is not. */}
      <div className="sm:hidden">
        <OverflowMenu actions={shown} />
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: RowAction }) {
  const blocked = Boolean(action.blockedReason);
  const destructive = action.kind === 'delete';
  const description = blocked ? `${action.label} — ${action.blockedReason}` : action.label;

  return (
    <Tooltip content={description}>
      <button
        type="button"
        onClick={blocked ? undefined : action.onSelect}
        disabled={blocked}
        aria-label={description}
        // `title` is dropped on purpose: the Tooltip already describes this,
        // and both together read the text twice to a screen reader and stack
        // two bubbles on a mouse.
        className={[
          'grid h-7 w-7 place-items-center rounded-[var(--ar-radius)] transition',
          blocked
            ? 'cursor-not-allowed text-[var(--ar-text-faint)]'
            : destructive
              ? 'text-[var(--ar-text-muted)] hover:bg-[var(--ar-danger-soft)] hover:text-[var(--ar-on-danger)]'
              : 'text-[var(--ar-text-muted)] hover:bg-[var(--ar-gray-100)] hover:text-[var(--ar-headings)]',
        ].join(' ')}
      >
        {React.createElement(ICONS[action.kind], { size: 15 })}
      </button>
    </Tooltip>
  );
}

/**
 * The same actions as a menu, for a screen too narrow to spare three columns
 * of icons.
 *
 * Closes on Escape and on a click anywhere else, because a menu that can only
 * be dismissed by choosing something is a menu that makes people choose
 * something.
 */
function OverflowMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = React.useState(false);
  const wrapper = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-7 w-7 place-items-center rounded-[var(--ar-radius)] text-[var(--ar-text-muted)] transition hover:bg-[var(--ar-gray-100)] hover:text-[var(--ar-headings)]"
      >
        <MoreIcon size={15} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[12rem] overflow-hidden rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-surface)] py-1 shadow-lg"
        >
          {actions.map((action) => {
            const blocked = Boolean(action.blockedReason);
            return (
              <button
                key={action.kind}
                type="button"
                role="menuitem"
                disabled={blocked}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className={[
                  'block w-full px-3 py-2 text-left text-[0.85rem] transition',
                  blocked
                    ? 'cursor-not-allowed text-[var(--ar-text-faint)]'
                    : action.kind === 'delete'
                      ? 'text-[var(--ar-on-danger)] hover:bg-[var(--ar-danger-soft)]'
                      : 'text-[var(--ar-text)] hover:bg-[var(--ar-gray-100)]',
                ].join(' ')}
              >
                {action.label}
                {blocked ? (
                  // The reason belongs in the menu itself here. There is no
                  // hover on the device this menu exists for, so a tooltip
                  // would be a reason nobody can read.
                  <span className="mt-0.5 block text-[0.75rem] text-[var(--ar-text-faint)]">
                    {action.blockedReason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The column definition, so no table has to remember that this one is last,
 * right-aligned, unsortable and called "Actions".
 */
export function actionsColumn<Row>(render: (row: Row) => React.ReactNode) {
  return {
    id: 'actions',
    header: 'Actions',
    enableSorting: false,
    meta: { align: 'right' as const },
    cell: ({ row }: { row: { original: Row } }) => render(row.original),
  };
}
