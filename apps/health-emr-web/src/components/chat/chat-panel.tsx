'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { Button, Card, EmptyState, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { SendIcon, PaperclipIcon } from '@/components/ui/icons';

interface Thread {
  id: string;
  kind: string;
  subject: string | null;
  lastMessageAt: string | null;
  unread: boolean;
  /** Null on a thread that is not about one person, e.g. clinical support. */
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
  PATIENT_PROVIDER: 'With your care team',
  PHARMACY_SUPPORT: 'Pharmacy support',
  PROVIDER_SUPPORT: 'Clinical support',
  GENERAL: 'Team',
};

/**
 * Secure messaging.
 *
 * Shared across every role, because the rules are the same everywhere: you see a
 * thread if you are in it. Message content renders here and only here — the
 * notification that tells you about it carries nothing.
 */
export function ChatPanel() {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void api<{ data: Thread[] }>('v1/chat/threads?limit=50')
      .then(({ data }) => {
        setThreads(data);
        // Functional form so `active` is not a dependency — selecting the first
        // thread should happen only when nothing is selected yet, and reading
        // the current value here is exactly what the updater is for.
        setActive((current) => current ?? data[0]?.id ?? null);
      })
      .catch(() => setThreads([]));
  }, []);

  const load = React.useCallback(async (threadId: string) => {
    const { data } = await api<{ data: Message[] }>(`v1/chat/threads/${threadId}/messages`);
    setMessages(data);
    setThreads((current) => current.map((t) => (t.id === threadId ? { ...t, unread: false } : t)));
  }, []);

  React.useEffect(() => {
    if (active) void load(active).catch(() => setMessages([]));
  }, [active, load]);

  /**
   * A photograph goes into the conversation, which means it goes into the
   * chart — the clinician prescribes against it and it stays with the record.
   * Sent by text instead it would live in a carrier's network and the phone's
   * gallery, and the one place it would not be is the chart.
   */
  const attach = async (file: File) => {
    if (!active) return;
    setBusy(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (draft.trim()) form.append('caption', draft.trim());

      // No JSON content-type: the browser sets the multipart boundary itself.
      await api(`v1/chat/threads/${active}/attachments`, { method: 'POST', body: form });
      setDraft('');
      await load(active);
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : 'That file could not be sent');
    } finally {
      setBusy(false);
    }
  };

  const activeThread = React.useMemo(
    () => threads.find((thread) => thread.id === active) ?? null,
    [threads, active],
  );

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    setBusy(true);
    try {
      await api(`v1/chat/threads/${active}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: draft }),
      });
      setDraft('');
      await load(active);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="p-0">
        <p className="border-b border-[var(--ar-border-soft)] px-4 py-3 text-sm font-semibold">
          Conversations
        </p>
        {threads.length === 0 ? (
          <EmptyState title="No conversations" />
        ) : (
          <ul className="max-h-[32rem] overflow-y-auto">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  onClick={() => setActive(thread.id)}
                  className={cn(
                    'block w-full border-b border-[var(--ar-border-soft)] px-4 py-3 text-left text-sm transition last:border-0',
                    active === thread.id
                      ? 'bg-[var(--ar-primary-soft)]'
                      : 'hover:bg-[var(--ar-body-bg)]',
                  )}
                >
                  {/* Who it is with, first.
                      A clinician holds twenty of these at once, and every one
                      of them labelled "With your care team" is a list with no
                      information in it — the name is the only thing that tells
                      them apart. `title` carries the full name for the ones
                      that do not fit. */}
                  <span className="flex items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate font-medium"
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
                  <span className="mt-0.5 flex items-baseline gap-1.5 text-xs text-[var(--ar-text-muted)]">
                    <span className="min-w-0 truncate" title={secondLine(thread)}>
                      {secondLine(thread)}
                    </span>
                    {thread.lastMessageAt ? (
                      <span
                        className="ml-auto shrink-0 tabular-nums text-[var(--ar-text-faint)]"
                        title={new Date(thread.lastMessageAt).toLocaleString()}
                      >
                        {ago(thread.lastMessageAt)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex min-h-[32rem] flex-col p-0">
        {/* Who you are writing to, kept on screen while you write it. The list
            on the left scrolls away, and a message meant for one patient sent
            to another is not a recoverable mistake. */}
        {activeThread ? (
          <div className="flex items-baseline gap-2 border-b border-[var(--ar-border-soft)] px-5 py-3">
            <span className="truncate text-sm font-semibold" title={activeThread.patient?.name}>
              {activeThread.patient?.name ?? KIND_LABEL[activeThread.kind] ?? 'Conversation'}
            </span>
            <span className="truncate text-xs text-[var(--ar-text-muted)]">
              {secondLine(activeThread)}
            </span>
          </div>
        ) : null}

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <EmptyState title="No messages" hint="Say something to start." />
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
                    message.mine
                      ? 'bg-[var(--ar-primary)] text-white'
                      : 'bg-[var(--ar-gray-50)] text-[var(--ar-body-color)]',
                  )}
                >
                  {!message.mine ? (
                    <p className="mb-0.5 text-xs font-semibold opacity-70">{message.author}</p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.attachments?.map((attachment) => (
                    <Attached key={attachment.id} threadId={active!} attachment={attachment} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {active ? (
          <div className="border-t border-[var(--ar-border-soft)]">
            {uploadError ? (
              <p className="px-4 pt-3 text-[0.8rem] text-[var(--ar-danger)]">{uploadError}</p>
            ) : null}
            <form onSubmit={send} className="flex items-end gap-2 p-4">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a secure message…"
                className="min-h-11"
              />

              {/* A photograph answers questions a sentence cannot — what the
                  injection site looks like today. It is sent here rather than
                  by text so it lands in the chart. */}
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
                variant="outline"
                icon={PaperclipIcon}
                iconOnly
                disabled={busy}
                aria-label="Send a photograph or document"
                title="Send a photograph or document"
                onClick={() => fileInput.current?.click()}
              />

              <Button type="submit" icon={SendIcon} disabled={busy || !draft.trim()}>
                Send
              </Button>
            </form>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * An attachment in the thread.
 *
 * Fetched through the API rather than linked from a public URL: the bytes are
 * a patient's photograph, every read is recorded against their chart, and a
 * URL that worked without a session would be neither.
 */
function Attached({ threadId, attachment }: { threadId: string; attachment: Attachment }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const isImage = attachment.mime.startsWith('image/');

  React.useEffect(() => {
    if (!isImage) return undefined;

    let url: string | null = null;
    let live = true;

    fetch(`/api/bff/v1/chat/threads/${threadId}/attachments/${attachment.id}`)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('unavailable'))))
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
      // The blob would otherwise be held for the life of the document.
      if (url) URL.revokeObjectURL(url);
    };
  }, [threadId, attachment.id, isImage]);

  if (!isImage || failed) {
    return (
      <a
        href={`/api/bff/v1/chat/threads/${threadId}/attachments/${attachment.id}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 text-[0.8rem] underline"
      >
        <PaperclipIcon className="h-3.5 w-3.5" />
        {attachment.fileName ?? 'Attachment'}
      </a>
    );
  }

  return src ? (
    /* eslint-disable-next-line @next/next/no-img-element --
       A blob URL held in memory, not a remote asset. next/image cannot
       optimise it, and pointing its loader at it would fetch the patient's
       photograph a second time through a different path. */
    <img
      src={src}
      alt={attachment.fileName ?? 'Attachment'}
      className="mt-2 max-h-72 w-full rounded-[var(--ar-radius)] object-contain"
    />
  ) : (
    <div className="ar-skeleton mt-2 h-32 w-48 rounded-[var(--ar-radius)]" />
  );
}

/**
 * The line under the name.
 *
 * The MRN is there because two patients share a name more often than anybody
 * expects, and a clinician opening the wrong chart is the thing worth spending
 * a line of text to prevent.
 */
function secondLine(thread: Thread): string {
  const kind = KIND_LABEL[thread.kind] ?? thread.kind;
  if (!thread.patient) return thread.subject ?? kind;
  return [thread.patient.mrn, thread.subject ?? kind].filter(Boolean).join(' · ');
}

/** How long ago, in the units somebody scanning a list actually reads. */
function ago(when: string): string {
  const minutes = Math.floor((Date.now() - new Date(when).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}
