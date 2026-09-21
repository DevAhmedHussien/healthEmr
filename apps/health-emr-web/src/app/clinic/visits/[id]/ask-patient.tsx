'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { Alert, Button } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import type { UseFormReturn } from 'react-hook-form';
import { Form } from '@/components/form/form';
import { TextAreaField } from '@/components/form/fields';
import { MessageIcon } from '@/components/ui/icons';

const schema = z.object({
  question: z
    .string()
    .trim()
    .min(10, 'Ask a question the patient can actually answer')
    .max(2000, 'Keep it to one question'),
});
type Values = z.infer<typeof schema>;

const SUGGESTIONS = [
  'Could you send a photograph of the affected area, taken in good light?',
  'Did you finish the last course, and how did you get on with it?',
  'Are you taking anything else at the moment, including anything over the counter?',
];

/**
 * Asking the patient something before deciding.
 *
 * The alternative, when the form does not answer the question a clinician
 * actually has, is to approve on an incomplete picture or refuse somebody who
 * would have answered in a sentence — and both are worse for the patient.
 *
 * The question goes into the conversation they already have with this
 * clinician, where they can reply in words or attach a photograph and the
 * answer becomes part of the chart. They are nudged by text or email, and that
 * nudge says nothing clinical: it arrives on a lock screen.
 */
export function AskPatient({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(values: Values) {
    setError(null);
    try {
      await api(`v1/clinic/visits/${visitId}/request-information`, {
        method: 'POST',
        body: JSON.stringify({ question: values.question }),
      });
      setOpen(false);
      router.push('/clinic');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : (caught as Error).message);
    }
  }

  return (
    <>
      <Button variant="outline" icon={MessageIcon} onClick={() => setOpen(true)}>
        Ask the patient
      </Button>

      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Ask the patient"
          description={[
            'This goes into your conversation with them, where they can reply or attach a photograph.',
            'The visit waits for their answer and comes back to you as soon as it arrives.',
          ]}
          width="lg"
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Form<Values>
            schema={schema as never}
            defaultValues={{ question: '' }}
            onSubmit={submit as never}
          >
            {(form: UseFormReturn<Values>) => (
              <>
                <TextAreaField<Values>
                  name="question"
                  label="Your question"
                  rows={4}
                  hint="Written to the patient, in your name. Plain words — they are not a clinician."
                />

                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() =>
                        form.setValue('question', suggestion, {
                          shouldValidate: true,
                          shouldDirty: true,
                        })
                      }
                      className="rounded-full border border-[var(--ar-border)] px-3 py-1 text-[0.75rem] text-[var(--ar-text-muted)] hover:border-[var(--ar-primary)] hover:text-[var(--ar-primary)]"
                    >
                      {suggestion.length > 46 ? `${suggestion.slice(0, 44)}…` : suggestion}
                    </button>
                  ))}
                </div>

                <Alert tone="info">
                  They get a message saying their clinician has a question — and nothing more. No
                  medication, no condition, nothing that implies one.
                </Alert>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" icon={MessageIcon} disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Sending…' : 'Send and put on hold'}
                  </Button>
                </div>
              </>
            )}
          </Form>
        </Modal>
      ) : null}
    </>
  );
}
