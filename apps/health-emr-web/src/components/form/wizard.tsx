'use client';

import * as React from 'react';
import { useFormContext, type FieldValues, type Path } from 'react-hook-form';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { CheckIcon } from '@/components/ui/icons';

export interface WizardStep<T extends FieldValues> {
  id: string;
  title: string;
  description?: string;
  /** Validated before this step will advance. */
  fields: Array<Path<T>>;
  render: () => React.ReactNode;
  /** A step that manages its own completion, such as document upload. */
  canAdvance?: () => boolean;
}

/**
 * A stepped form.
 *
 * Each step validates only its own fields before advancing, so a long
 * application surfaces a mistake on the screen where it was made rather than
 * dumping twenty errors at the end.
 *
 * Steps already visited stay clickable — someone half way through who wants to
 * check what they typed on step one should not have to abandon their progress.
 */
export function Wizard<T extends FieldValues>({
  steps,
  onSubmit,
  submitLabel = 'Submit',
  busy,
}: {
  steps: Array<WizardStep<T>>;
  onSubmit: () => void;
  submitLabel?: string;
  busy?: boolean;
}) {
  const { trigger } = useFormContext<T>();
  const [index, setIndex] = React.useState(0);
  const [furthest, setFurthest] = React.useState(0);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const next = async () => {
    const valid = await trigger(step.fields, { shouldFocus: true });
    if (!valid) return;
    if (step.canAdvance && !step.canAdvance()) return;

    const target = Math.min(index + 1, steps.length - 1);
    setIndex(target);
    setFurthest((value) => Math.max(value, target));
  };

  const submit = async () => {
    const valid = await trigger(undefined, { shouldFocus: true });
    if (!valid) return;
    onSubmit();
  };

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((entry, position) => {
          const done = position < furthest;
          const current = position === index;
          const reachable = position <= furthest;

          return (
            <li key={entry.id} className="flex items-center">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && setIndex(position)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--ar-radius)] px-2.5 py-1.5 text-left transition',
                  reachable
                    ? 'cursor-pointer hover:bg-[var(--ar-gray-50)]'
                    : 'cursor-not-allowed opacity-50',
                )}
              >
                <span
                  className={cn(
                    'grid h-7 w-7 flex-none place-items-center rounded-full text-[0.75rem] font-semibold tabular-nums',
                    current
                      ? 'bg-[var(--ar-primary)] text-white'
                      : done
                        ? 'bg-[var(--ar-success-soft)] text-[var(--ar-on-success)]'
                        : 'bg-[var(--ar-gray-200)] text-[var(--ar-text-muted)]',
                  )}
                >
                  {done ? <CheckIcon size={14} strokeWidth={3} /> : position + 1}
                </span>
                <span
                  className={cn(
                    'hidden text-[0.82rem] sm:block',
                    current
                      ? 'font-semibold text-[var(--ar-headings)]'
                      : 'text-[var(--ar-text-muted)]',
                  )}
                >
                  {entry.title}
                </span>
              </button>
              {position < steps.length - 1 ? (
                <span aria-hidden className="mx-0.5 h-px w-4 bg-[var(--ar-border)] sm:w-6" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div>
        <h3 className="text-[1.15rem]">{step.title}</h3>
        {step.description ? (
          <p className="mt-1 text-[0.875rem] text-[var(--ar-text-muted)]">{step.description}</p>
        ) : null}
      </div>

      <div>{step.render()}</div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--ar-border)] pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0 || busy}
        >
          Back
        </Button>

        <span className="text-[0.78rem] tabular-nums text-[var(--ar-text-faint)]">
          Step {index + 1} of {steps.length}
        </span>

        {isLast ? (
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Submitting…' : submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={next} disabled={busy}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
