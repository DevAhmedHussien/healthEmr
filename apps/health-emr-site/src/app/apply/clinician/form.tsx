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
import { isRealDate } from '@/lib/masks';

interface Licence {
  state: string;
  licenseNumber: string;
  expiresAt: string;
}

/**
 * A clinician's application.
 *
 * The licences are the substance of it. Routing depends entirely on them, and
 * each needs a state, a number and an expiry — so they are collected as rows
 * rather than as a list of state codes, which would produce an application we
 * could not act on without going back and asking.
 */
export function ClinicianForm() {
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [phone, setPhone] = React.useState('');
  const [categories, setCategories] = React.useState<string[]>([]);
  const [licences, setLicences] = React.useState<Licence[]>([
    { state: '', licenseNumber: '', expiresAt: '' },
  ]);

  const setLicence = (index: number, patch: Partial<Licence>) =>
    setLicences((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  // `expiresAt` is only set once eight digits have been typed, so a row with a
  // half-finished date simply has none — which is why the message below talks
  // about completing the row rather than about the date being invalid.
  const complete = licences.filter(
    (row) => row.state && row.licenseNumber.trim() && isRealDate(row.expiresAt),
  );
  const started = licences.filter((row) => row.state || row.licenseNumber.trim());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete.length) {
      setError(
        started.length
          ? 'Each licence needs a state, a number, and a full expiry date as MM-DD-YYYY.'
          : 'Add at least one licence, with its number and expiry date.',
      );
      return;
    }
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const years = data.get('yearsExperience');

    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'clinician',
          payload: {
            firstName: data.get('firstName'),
            lastName: data.get('lastName'),
            email: data.get('email'),
            phone,
            credentials: data.get('credentials'),
            npi: data.get('npi'),
            ...(data.get('deaNumber') ? { deaNumber: data.get('deaNumber') } : {}),
            ...(years ? { yearsExperience: Number(years) } : {}),
            ...(data.get('bio') ? { bio: data.get('bio') } : {}),
            specialties: [],
            requestedCategorySlugs: categories,
            licenses: complete.map((row) => ({
              state: row.state,
              licenseNumber: row.licenseNumber.trim(),
              expiresAt: row.expiresAt,
            })),
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
        title="Application received"
        body="We will email you a link to upload your licences and insurance. Each licence is checked against the issuing board before it starts routing visits to you — we will tell you where each one stands."
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-12">
      <Fieldset legend="About you">
        <Field label="First name" required>
          <Input name="firstName" required autoComplete="given-name" />
        </Field>
        <Field label="Last name" required>
          <Input name="lastName" required autoComplete="family-name" />
        </Field>
        <Field label="Email" required>
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
        <Field label="Credentials" hint="MD, DO, NP, PA" required>
          <Input name="credentials" required placeholder="MD" />
        </Field>
        <Field label="NPI" hint="Ten digits." required>
          <Input name="npi" required inputMode="numeric" pattern="\d{10}" placeholder="1234567890" />
        </Field>
        <Field label="DEA number" hint="Only if you hold one.">
          <Input name="deaNumber" />
        </Field>
        <Field label="Years in practice">
          <Input name="yearsExperience" type="number" min={0} max={70} />
        </Field>
      </Fieldset>

      <Fieldset
        legend="Your licences"
        hint="One row per state. These decide which visits can reach you, so each needs its number and expiry date, typed MM-DD-YYYY."
        columns={1}
      >
        <div className="space-y-3">
          {licences.map((licence, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--paper-tint)] p-4 sm:grid-cols-[7rem_1fr_11rem_auto]"
            >
              <Select
                aria-label={`State for licence ${index + 1}`}
                value={licence.state}
                onChange={(event) => setLicence(index, { state: event.target.value })}
              >
                <option value="">State</option>
                {US_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Licence number ${index + 1}`}
                placeholder="Licence number"
                value={licence.licenseNumber}
                onChange={(event) => setLicence(index, { licenseNumber: event.target.value })}
              />
              <MaskedInput
                mask="date"
                aria-label={`Expiry date for licence ${index + 1}`}
                placeholder="MM-DD-YYYY"
                value={licence.expiresAt}
                onValueChange={(expiresAt) => setLicence(index, { expiresAt })}
              />
              <button
                type="button"
                onClick={() => setLicences((rows) => rows.filter((_, i) => i !== index))}
                disabled={licences.length === 1}
                className="rounded-[var(--radius)] px-3 text-[0.88rem] text-[var(--muted)] transition hover:text-[#b3261e] disabled:opacity-30"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setLicences((rows) => [...rows, { state: '', licenseNumber: '', expiresAt: '' }])
          }
          className="justify-self-start text-[0.92rem] text-[var(--brand)] hover:underline"
        >
          + Add another state
        </button>
      </Fieldset>

      <Fieldset
        legend="What you want to review"
        hint="Credentialling is per treatment area. Choose the ones you are comfortable prescribing in."
        columns={1}
      >
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
        <Field label="Anything else" hint="Subspecialties, availability, questions.">
          <Textarea name="bio" rows={4} />
        </Field>
      </Fieldset>

      {error ? (
        <p role="alert" className="rounded-[var(--radius)] bg-[#fdecea] px-4 py-3 text-[0.92rem] text-[#b3261e]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-5">
        <SubmitButton busy={busy}>Submit application</SubmitButton>
        <p className="text-[0.86rem] text-[var(--muted)]">
          Documents are uploaded at the next step, not here.
        </p>
      </div>
    </form>
  );
}
