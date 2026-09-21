'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Role } from '@health-emr/types';
import { cn } from '@/lib/utils';
import { NAV, ROLE_LABEL } from './nav';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';
import { MenuIcon } from '@/components/ui/icons';
import { ChatDock } from '@/components/chat/chat-dock';

/**
 * The frame every signed-in screen sits in: sidebar, topbar, content.
 *
 * One shell for all five roles, differing only in its nav data — so a fix to the
 * layout lands everywhere at once, and no role quietly drifts into a different
 * interface.
 */
/** Each role reads its messages under its own console. */
const MESSAGES_HREF: Partial<Record<Role, string>> = {
  [Role.PROVIDER]: '/clinic/messages',
  [Role.ADMIN]: '/admin/messages',
  [Role.PHARMACY]: '/dispensary/messages',
  [Role.SUPER_ADMIN]: '/super-admin/messages',
  [Role.PATIENT]: '/portal/messages',
};

export function PortalShell({
  role,
  name,
  email,
  children,
}: {
  role: Role;
  name: string;
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const items = NAV[role] ?? [];

  const groups = items.reduce<Record<string, typeof items>>((acc, item) => {
    const key = item.group ?? '';
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  /**
   * Which nav item the current URL belongs to.
   *
   * A plain prefix test lights up the index item on every page beneath it —
   * `/super-admin/patients` starts with `/super-admin`, so Overview stayed
   * highlighted alongside whatever you actually opened. Resolving the *longest*
   * matching href first means the most specific item wins, and the index only
   * highlights on its own page.
   */
  const activeHref = items
    .map((item) => item.href)
    .filter((href) => href === pathname || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  const isActive = (href: string) => href === activeHref;

  /** What the top bar names: the page you are on, not the role you hold. */
  const activeLabel = items.find((item) => item.href === activeHref)?.label ?? ROLE_LABEL[role];

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="bg-[var(--ar-primary)] grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold text-white">
          H
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">HealthEMR</p>
          <p className="text-xs text-[var(--ar-text-faint)]">{ROLE_LABEL[role]}</p>
        </div>
      </div>

      <div className="flex-1 space-y-5 px-3 py-2">
        {Object.entries(groups).map(([group, groupItems]) => (
          <div key={group}>
            {group ? (
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ar-text-faint)]">
                {group}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {groupItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                      isActive(item.href)
                        ? 'bg-[var(--ar-primary-soft)] font-semibold text-[var(--ar-primary)]'
                        : 'text-[var(--ar-text-muted)] hover:bg-[var(--ar-body-bg)] hover:text-[var(--ar-body-color)]',
                    )}
                  >
                    <item.icon size={17} strokeWidth={isActive(item.href) ? 2.3 : 2} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-none border-r border-[var(--ar-border)] bg-white md:block">
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-[var(--ar-border)] bg-white">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--ar-border)] bg-white/90 px-4 py-3 backdrop-blur md:px-8">
          <button
            className="rounded-lg p-2 text-[var(--ar-text-muted)] hover:bg-[var(--ar-body-bg)] md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <MenuIcon size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.95rem] font-medium text-[var(--ar-headings)]">
              {activeLabel}
            </p>
          </div>
          <NotificationBell />
          <UserMenu role={role} name={name} email={email} />
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>

        {/* Available from wherever the work is. Answering one question while
            looking at a chart used to mean navigating away from the chart,
            replying, and navigating back — which in practice meant the reply
            waited. */}
        <ChatDock messagesHref={MESSAGES_HREF[role] ?? '/portal/messages'} />
      </div>
    </div>
  );
}
