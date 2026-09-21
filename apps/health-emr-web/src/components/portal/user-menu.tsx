'use client';

import * as React from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { clearListCache } from '@/lib/list-cache';
import type { Role } from '@health-emr/types';
import { cn, initials } from '@/lib/utils';
import { ROLE_LABEL } from './nav';
import { ChevronDownIcon, LogOutIcon, UserIcon } from '@/components/ui/icons';

/**
 * Who you are, in the top bar.
 *
 * Follows the AscendRehab pattern: name and role stacked to the left of an
 * avatar, opening onto the two things anybody actually wants from it — their own
 * details, and the way out. It lives here rather than in the sidebar because
 * that is where a person looks for it, and because the sidebar is for moving
 * around the product, not for administering yourself.
 */
export function UserMenu({ role, name, email }: { role: Role; name: string; email: string }) {
  const [open, setOpen] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-2.5 rounded-[var(--ar-radius)] py-1 pl-2.5 pr-1.5 transition',
          open ? 'bg-[var(--ar-body-bg)]' : 'hover:bg-[var(--ar-body-bg)]',
        )}
      >
        <span className="hidden text-right leading-tight sm:block">
          <span className="block text-[0.82rem] font-semibold text-[var(--ar-headings)]">
            {name}
          </span>
          <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
            {ROLE_LABEL[role]}
          </span>
        </span>
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--ar-primary-soft)] text-[0.78rem] font-semibold text-[var(--ar-primary)]">
          {initials(...name.split(' '))}
        </span>
        <ChevronDownIcon
          size={15}
          className={cn(
            'hidden text-[var(--ar-text-faint)] transition-transform sm:block',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-[var(--ar-radius-lg)] border border-[var(--ar-border)] bg-white shadow-[0_8px_30px_rgba(34,48,62,0.16)]"
        >
          <div className="border-b border-[var(--ar-border-soft)] px-4 py-3">
            <p className="truncate text-[0.88rem] font-medium text-[var(--ar-headings)]">{name}</p>
            <p className="truncate text-[0.76rem] text-[var(--ar-text-faint)]">{email}</p>
          </div>

          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-[0.86rem] text-[var(--ar-body-color)] no-underline transition hover:bg-[var(--ar-primary-soft)] hover:text-[var(--ar-primary)]"
          >
            <UserIcon size={16} />
            My details
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // The list cache holds PHI in this tab's heap. Signing out has to
              // empty it, or the next person to sign in on this machine opens a
              // table already populated with the last one's patients.
              clearListCache();
              void signOut({ callbackUrl: '/login' });
            }}
            className="flex w-full items-center gap-2.5 border-t border-[var(--ar-border-soft)] px-4 py-2.5 text-left text-[0.86rem] text-[var(--ar-text-muted)] transition hover:bg-[var(--ar-danger-soft)] hover:text-[var(--ar-danger)]"
          >
            <LogOutIcon size={16} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
