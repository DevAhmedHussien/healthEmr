'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { EyeIcon } from './icons';

/**
 * A password field with a reveal toggle, for plain controlled forms.
 *
 * The form kit's `PasswordField` is bound to react-hook-form; this is the same
 * behaviour for the dialogs that hold their own state. Same rules: starts
 * hidden, out of the tab order, and says which state it is in.
 */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn('ar-input pr-11', props.className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--ar-text-faint)] transition-colors hover:text-[var(--ar-primary)]"
      >
        <EyeIcon size={18} />
      </button>
    </div>
  );
}
