'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { BellIcon } from '@/components/ui/icons';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * The bell.
 *
 * Renders full content on purpose — this surface is behind authentication, which
 * is exactly why the email and SMS copies of the same notification carry none.
 */
export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [rows, setRows] = React.useState<NotificationRow[]>([]);

  const refresh = React.useCallback(async () => {
    try {
      const { unread: count } = await api<{ unread: number }>('v1/notifications/unread-count');
      setUnread(count);
    } catch {
      // A failing badge must never break the page around it.
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const load = async () => {
    setOpen((value) => !value);
    if (open) return;
    try {
      const { data } = await api<{ data: NotificationRow[] }>('v1/notifications?limit=15');
      setRows(data);
    } catch {
      setRows([]);
    }
  };

  const markRead = async (id: string) => {
    await api(`v1/notifications/${id}/read`, { method: 'POST' });
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, readAt: new Date().toISOString() } : row)),
    );
    void refresh();
  };

  return (
    <div className="relative">
      <button
        onClick={load}
        className="relative rounded-lg p-2 text-[var(--ar-text-muted)] transition hover:bg-[var(--ar-body-bg)]"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <BellIcon size={19} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--ar-danger)] px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--ar-border)] bg-white shadow-lg">
          <p className="border-b border-[var(--ar-border-soft)] px-4 py-2.5 text-sm font-semibold">
            Notifications
          </p>
          <ul className="max-h-96 overflow-y-auto">
            {rows.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-[var(--ar-text-faint)]">
                Nothing yet
              </li>
            ) : (
              rows.map((row) => (
                <li
                  key={row.id}
                  className={`border-b border-[var(--ar-border-soft)] px-4 py-3 last:border-0 ${
                    row.readAt ? '' : 'bg-[var(--ar-primary-soft)]/40'
                  }`}
                >
                  <p className="text-sm font-medium">{row.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--ar-text-muted)]">{row.body}</p>
                  {!row.readAt ? (
                    <button
                      onClick={() => markRead(row.id)}
                      className="mt-1.5 text-xs font-medium text-[var(--ar-primary)]"
                    >
                      Mark read
                    </button>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
