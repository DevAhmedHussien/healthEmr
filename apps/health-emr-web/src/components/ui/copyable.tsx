'use client';

import * as React from 'react';
import { Button } from '@/components/ui/primitives';
import { CheckIcon, CopyIcon } from '@/components/ui/icons';

/**
 * A value that exists to be copied.
 *
 * Integration credentials are the case this is for: nobody reads a 48-character
 * token, they paste it. So the value is shown in full but the control does the
 * work, and it confirms — a copy button that looks identical before and after
 * leaves you pressing it twice and pasting nothing.
 *
 * `clipboard.writeText` needs a secure context. Over plain HTTP on anything but
 * localhost it is simply absent, so the fallback selects the text instead and
 * says so, rather than failing silently.
 */
export function Copyable({
  value,
  label,
  mono = true,
  tone = 'default',
}: {
  value: string;
  /** Announced to screen readers, e.g. "company key". */
  label: string;
  mono?: boolean;
  /** `secret` gets the warning treatment: this is a credential in the clear. */
  tone?: 'default' | 'secret';
}) {
  // An input collapses newlines, so a multi-line value would be shown as one
  // unreadable line while copying correctly — the display quietly disagreeing
  // with what you get. A textarea shows what the clipboard will hold.
  const lines = value.split('\n').length;
  const multiline = lines > 1;
  const [copied, setCopied] = React.useState(false);
  const [manual, setManual] = React.useState(false);
  const field = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setManual(false);
    } catch {
      field.current?.select();
      setManual(true);
    }
  }

  return (
    <div className="grid gap-1">
      <div
        className={`flex gap-2 rounded-[var(--ar-radius)] border p-1.5 pl-3 ${
          multiline ? 'items-start' : 'items-center'
        } ${
          tone === 'secret'
            ? 'border-[var(--ar-warning)] bg-[var(--ar-warning-soft)]'
            : 'border-[var(--ar-border)] bg-[var(--ar-body-bg)]'
        }`}
      >
        {multiline ? (
          <textarea
            ref={field as React.RefObject<HTMLTextAreaElement>}
            readOnly
            value={value}
            rows={lines}
            aria-label={label}
            onFocus={(event) => event.currentTarget.select()}
            className={`min-w-0 flex-1 resize-none bg-transparent py-1 text-[0.78rem] leading-relaxed outline-none ${
              mono ? 'font-mono' : ''
            }`}
          />
        ) : (
          <input
            ref={field as React.RefObject<HTMLInputElement>}
            readOnly
            value={value}
            aria-label={label}
            onFocus={(event) => event.currentTarget.select()}
            className={`min-w-0 flex-1 bg-transparent text-[0.82rem] outline-none ${
              mono ? 'font-mono tabular-nums' : ''
            }`}
          />
        )}
        <Button
          size="sm"
          variant={copied ? 'secondary' : 'ghost'}
          icon={copied ? CheckIcon : CopyIcon}
          onClick={copy}
          className="shrink-0 whitespace-nowrap"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {manual ? (
        <span className="text-[0.75rem] text-[var(--ar-text-faint)]">
          Your browser will not let a page write to the clipboard here. It is selected — press
          {' ⌘C'} or Ctrl+C.
        </span>
      ) : null}
    </div>
  );
}
