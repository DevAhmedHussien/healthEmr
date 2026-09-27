'use client';

import * as React from 'react';
import {
  Field,
  Fieldset,
  Input,
  MaskedInput,
  Select,
  Sent,
  SubmitButton,
  Textarea,
} from '@/components/form';
import { CATEGORIES, US_STATES } from '@/lib/states';
import { StatePicker } from '@/components/form';

const VOLUMES = [
  'Not launched yet',
  'Under 100 visits a month',
  '100 – 500',
  '500 – 2,000',
  'Over 2,000',
];

export function TelehealthForm() {
  const [phone, setPhone] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [states, setStates] = React.useState<string[]>([]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'telehealth',
          payload: {
            company: data.get('company'),
            website: data.get('website') || null,
            contactName: data.get('contactName'),
            email: data.get('email'),
            phone,
            monthlyVolume: data.get('monthlyVolume'),
            categories,
            states,
            currentSystem: data.get('currentSystem') || null,
            notes: data.get('notes') || null,
          },
        }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(detail?.message ?? 'That did not send.');
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Sent
        title="Thank you — we have it"
        body="We will come back to you within one working day with times for a call, and an honest read on where our clinician network is strong for the states and categories you named."
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-12">
      <Fieldset legend="Your business" hint="Who you are and how to reach you.">
        <Field label="Company name" required className="sm:col-span-2">
          <Input name="company" required autoComplete="organization" placeholder="Acme Health" />
        </Field>
        <Field label="Website" hint="If you have one yet.">
          <Input name="website" type="url" placeholder="https://" autoComplete="url" />
        </Field>
        <Field label="Your name" required>
          <Input name="contactName" required autoComplete="name" />
        </Field>
        <Field label="Work email" required>
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Phone" hint="US number." required>
          <MaskedInput
            mask="phone"
            required
            aria-label="Phone"
            placeholder="(555) 123-4567"
            value={phone}
            onValueChange={setPhone}
          />
        </Field>
      </Fieldset>

      <Fieldset
        legend="What you want to offer"
        hint="This is what tells us whether we are a fit — say it roughly if you are not sure yet."
        columns={1}
      >
        <Field label="Treatment areas" required>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((category) => {
              const on = categories.includes(category.slug);
              return (
                <button
                  key={category.slug}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setCategories(
                      on
                        ? categories.filter((slug) => slug !== category.slug)
                        : [...categories, category.slug],
                    )
                  }
                  className={
                    on
                      ? 'rounded-full bg-[var(--brand)] px-4 py-2 text-[0.9rem] font-medium text-white'
                      : 'rounded-full border border-[var(--line)] px-4 py-2 text-[0.9rem] text-[var(--muted)] transition hover:border-[var(--muted)]'
                  }
                >
                  {category.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="States you sell into"
          hint="Where your patients are. We will tell you where our network is thin before you commit to anything."
          required
        >
          <StatePicker
            label="States you sell into"
            states={US_STATES}
            value={states}
            onChange={setStates}
          />
        </Field>

        <Field label="Roughly how many visits a month" required>
          <Select name="monthlyVolume" required defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            {VOLUMES.map((volume) => (
              <option key={volume} value={volume}>
                {volume}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="What are you using today"
          hint="Beluga, another platform, your own build, or nothing yet."
        >
          <Input name="currentSystem" placeholder="e.g. Beluga Health" />
        </Field>

        <Field label="Anything else we should know">
          <Textarea name="notes" rows={4} placeholder="Timelines, pharmacies you already work with, questions." />
        </Field>
      </Fieldset>

      {error ? (
        <p role="alert" className="rounded-[var(--radius)] bg-[#fdecea] px-4 py-3 text-[0.92rem] text-[#b3261e]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-5">
        <SubmitButton busy={busy}>Request a demo</SubmitButton>
        <p className="text-[0.86rem] text-[var(--muted)]">
          No patient data on this form. We reply within one working day.
        </p>
      </div>
    </form>
  );
}
