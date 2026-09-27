'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useChatSocket, type IncomingMessage } from '@/lib/chat-socket';
import { cn } from '@/lib/utils';
import { Button, Textarea } from '@/components/ui/primitives';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  MessageIcon,
  PaperclipIcon,
  SendIcon,
  XIcon,
} from '@/components/ui/icons';

interface Thread {
  id: string;
  kind: string;
  subject: string | null;
  lastMessageAt: string | null;
  unread: boolean;
  patient: { mrn: string; name: string } | null;
}

interface Attachment {
  id: string;
  mime: string;
  size: number;
  fileName: string | null;
}

interface Message {
  id: string;
  author: string;
  authorRole: string;
  content: string;
  sentAt: string;
  mine: boolean;
  attachments: Attachment[];
}

const KIND_LABEL: Record<string, string> = {
  PATIENT_PROVIDER: 'Care team',
  PHARMACY_SUPPORT: 'Pharmacy support',
  PROVIDER_SUPPORT: 'Clinical support',
  GENERAL: 'Team',
};

/** Where the dock is unwelcome: it would cover the thing being worked on. */
const HIDDEN_ON = ['/login', '/apply', '/accept-invite', '/intake', '/welcome'];

/**
 * And on the Messages page itself.
 *
 * Two reasons, one of them a bug this caused: the launcher is fixed to the
 * bottom right, which is exactly where that page puts its Send button — so it
 * sat on top of it and swallowed the click. It is also redundant there, since
 * the whole page is the conversation.
 */
function isMessagesPage(pathname: string | null): boolean {
  return Boolean(pathname && /\/messages(\/|$)/.test(pathname));
}

/**
 * A conversation that follows you around the application.
 *
 * The full Messages page is the right place to work through a backlog. It is
 * the wrong place to answer one question while looking at a chart — which meant
 * navigating away from the visit, replying, and navigating back, and in
 * practice meant the reply waited. Docked, the conversation is available from
 * wherever the work is.
 *
 * A fifth larger than a typical messenger dock, because these conversations
 * carry clinical detail and photographs rather than one-line replies — at the
 * smaller size a set of directions wrapped to six lines. Capped against the
 * viewport so it never runs off a laptop screen.
 *
 * Bottom right, opposite the navigation. On the left it sat on top of the
 * sidebar, which is the one thing on the page that must always be clickable.
 *
 * Deliberately one conversation at a time rather than several tiled windows.
 * These threads carry patient information, and two charts open side by side is
 * how a message reaches the wrong person.
 */
export function ChatDock({ messagesHref }: { messagesHref: string }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  /** Null until the first answer, so "none" is never claimed before asking. */
  const [loaded, setLoaded] = React.useState(false);
  const [active, setActive] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const foot = React.useRef<HTMLDivElement>(null);

  const hidden =
    HIDDEN_ON.some((prefix) => pathname?.startsWith(prefix)) || isMessagesPage(pathname);

  const loadThreads = React.useCallback(async () => {
    try {
      const { data } = await api<{ data: Thread[] }>('v1/chat/threads?limit=20');
      setThreads(data);
    } catch {
      // A dock that cannot reach the API should be quiet, not alarming. The
      // Messages page reports the failure properly.
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadMessages = React.useCallback(async (threadId: string) => {
    const { data } = await api<{ data: Message[] }>(`v1/chat/threads/${threadId}/messages`);
    setMessages(data);
    setThreads((current) =>
      current.map((thread) => (thread.id === threadId ? { ...thread, unread: false } : thread)),
    );
  }, []);

  // The badge has to be right before anybody opens the dock, so the thread
  // list is polled while it is shut. Sixty seconds: often enough that a reply
  // is noticed within a minute, rarely enough to be free.
  React.useEffect(() => {
    if (hidden) return undefined;
    void loadThreads();
    const timer = window.setInterval(() => void loadThreads(), 60_000);
    return () => window.clearInterval(timer);
  }, [hidden, loadThreads]);

  React.useEffect(() => {
    if (!active) return;
    // Cleared first: the previous conversation's messages under the new
    // conversation's name is the one mistake this panel must not make.
    setMessages([]);
    void loadMessages(active).catch(() => setMessages([]));
  }, [active, loadMessages]);

  // Newest message in view, the way every messenger behaves.
  React.useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Escape steps back one level rather than closing outright: somebody deep in
  // a thread means to leave the thread, not the dock.
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (active) setActive(null);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, active]);

  /**
   * The same live delivery as the full Messages page.
   *
   * It matters more here: the dock is open *while* somebody works on something
   * else, which is exactly when they are not going to reload the page to find
   * out whether a patient replied.
   */
  const { watch } = useChatSocket(
    React.useCallback(
      (incoming: IncomingMessage) => {
        if (incoming.threadId === active) {
          setMessages((current) =>
            current.some((message) => message.id === incoming.messageId)
              ? current
              : [
                  ...current,
                  {
                    id: incoming.messageId,
                    author: incoming.author,
                    authorRole: incoming.authorRole,
                    content: incoming.content,
                    sentAt: incoming.sentAt,
                    mine: false,
                    attachments: [],
                  },
                ],
          );
          return;
        }

        // Another conversation: the badge has to move even when the dock is
        // shut, which is most of the time.
        void loadThreads();
      },
      [active, loadThreads],
    ),
  );

  React.useEffect(() => {
    if (active) watch(active);
  }, [active, watch]);

  const unread = threads.filter((thread) => thread.unread).length;
  const openThread = threads.find((thread) => thread.id === active) ?? null;

  if (hidden) return null;

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`v1/chat/threads/${active}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: draft }),
      });
      setDraft('');
      await loadMessages(active);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not send');
    } finally {
      setBusy(false);
    }
  };

  const attach = async (file: File) => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (draft.trim()) form.append('caption', draft.trim());
      await api(`v1/chat/threads/${active}/attachments`, { method: 'POST', body: form });
      setDraft('');
      await loadMessages(active);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That file could not be sent');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? `Messages, ${unread} unread` : 'Messages'}
        className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full! bg-[var(--ar-primary)] px-4 text-white shadow-lg transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ar-primary)]"
      >
        <MessageIcon size={18} />
        <span className="text-[0.85rem] font-medium">Messages</span>
        {unread ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[0.7rem] font-semibold text-[var(--ar-primary)]">
            {unread}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <section
      aria-label="Messages"
      className="fixed bottom-5 right-5 z-40 flex h-[33.6rem] max-h-[calc(100vh-2.5rem)] w-[25.2rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl! border border-[var(--ar-border)] bg-[var(--ar-card-bg)] shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-[var(--ar-border-soft)] bg-[var(--ar-gray-50)] px-3 py-2.5">
        {openThread ? (
          <button
            type="button"
            onClick={() => setActive(null)}
            aria-label="Back to conversations"
            className="rounded p-1 text-[var(--ar-text-muted)] hover:text-[var(--ar-primary)]"
          >
            <ArrowLeftIcon size={16} />
          </button>
        ) : (
          <MessageIcon size={16} className="text-[var(--ar-primary)]" />
        )}

        <span
          className="min-w-0 flex-1 truncate text-[0.85rem] font-semibold"
          title={openThread ? (openThread.patient?.name ?? undefined) : undefined}
        >
          {openThread
            ? (openThread.patient?.name ?? KIND_LABEL[openThread.kind] ?? 'Conversation')
            : 'Messages'}
        </span>

        {/* The dock answers one question well; a backlog belongs on the page
            built for it. */}
        <Link
          href={messagesHref}
          className="rounded p-1 text-[var(--ar-text-muted)] hover:text-[var(--ar-primary)]"
          aria-label="Open the full Messages page"
          title="Open the full Messages page"
        >
          <ChevronDownIcon size={16} className="-rotate-90" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close messages"
          className="rounded p-1 text-[var(--ar-text-muted)] hover:text-[var(--ar-danger)]"
        >
          <XIcon size={16} />
        </button>
      </header>

      {!openThread ? (
        <ul className="flex-1 overflow-y-auto">
          {!loaded ? (
            // Shaped like the rows about to replace it, so nothing jumps.
            Array.from({ length: 4 }).map((_, index) => (
              <li
                key={`loading-${index}`}
                className="flex flex-col gap-1.5 border-b border-[var(--ar-border-soft)] px-3 py-3 last:border-0"
              >
                <div className="ar-skeleton h-3 w-32" />
                <div className="ar-skeleton h-2.5 w-20" />
              </li>
            ))
          ) : threads.length === 0 ? (
            <li className="px-3 py-6 text-center text-[0.8rem] text-[var(--ar-text-muted)]">
              No conversations yet.
            </li>
          ) : (
            threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => setActive(thread.id)}
                  className="block w-full border-b border-[var(--ar-border-soft)] px-3 py-2.5 text-left last:border-0 hover:bg-[var(--ar-body-bg)]"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate text-[0.83rem] font-medium"
                      title={thread.patient?.name ?? undefined}
                    >
                      {thread.patient?.name ?? KIND_LABEL[thread.kind] ?? thread.kind}
                    </span>
                    {thread.unread ? (
                      <span
                        aria-label="Unread"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ar-primary)]"
                      />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.72rem] text-[var(--ar-text-muted)]">
                    {thread.patient?.mrn ?? thread.subject ?? KIND_LABEL[thread.kind]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <div className="ar-skeleton h-8 w-3/5 rounded-2xl" />
                <div className="ar-skeleton ml-auto h-8 w-2/5 rounded-2xl" />
                <div className="ar-skeleton h-8 w-1/2 rounded-2xl" />
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-1.5 text-[0.82rem]',
                    message.mine
                      ? 'bg-[var(--ar-primary)] text-white'
                      : 'bg-[var(--ar-gray-50)] text-[var(--ar-body-color)]',
                  )}
                >
                  {!message.mine ? (
                    <p className="mb-0.5 text-[0.68rem] font-semibold opacity-70">
                      {message.author}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.attachments?.length ? (
                    <a
                      href={`/api/bff/v1/chat/threads/${active}/attachments/${message.attachments[0].id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[0.72rem] underline"
                    >
                      <PaperclipIcon className="h-3 w-3" />
                      {message.attachments[0].fileName ?? 'Attachment'}
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={foot} />
          </div>

          {error ? (
            <p className="px-3 pb-1 text-[0.72rem] text-[var(--ar-danger)]">{error}</p>
          ) : null}

          <form
            onSubmit={send}
            className="flex items-end gap-1.5 border-t border-[var(--ar-border-soft)] p-2"
          >
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a reply…"
              rows={1}
              className="min-h-9 py-1.5 text-[0.82rem]"
              aria-label="Write a reply"
              onKeyDown={(event) => {
                // Enter sends, shift+enter makes a new line — what every
                // messenger does, and what fingers already expect.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(event as unknown as React.FormEvent);
                }
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void attach(file);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={PaperclipIcon}
              iconOnly
              disabled={busy}
              aria-label="Send a photograph or document"
              onClick={() => fileInput.current?.click()}
            />
            <Button type="submit" size="sm" icon={SendIcon} iconOnly aria-label="Send" disabled={busy || !draft.trim()} />
          </form>
        </>
      )}
    </section>
  );
}
