'use client';

import * as React from 'react';
import {
  Checkbox,
  Field,
  Fieldset,
  Input,
  MaskedInput,
  Select,
  Sent,
  StatePicker,
  SubmitButton,
  Textarea,
} from '@/components/form';
import { US_STATES } from '@/lib/states';

export function PharmacyForm() {
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [contactPhone, setContactPhone] = React.useState('');
  const [statesServed, setStatesServed] = React.useState<string[]>([]);
  const [compounded, setCompounded] = React.useState(false);
  const [branded, setBranded] = React.useState(false);
  const [outsourcing, setOutsourcing] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statesServed.length) {
      setError('Choose at least one state you can ship into.');
      return;
    }
    if (!compounded && !branded) {
      setError('Tell us whether you dispense compounded products, branded products, or both.');
      return;
    }
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const optional = (key: string) => {
      const value = data.get(key);
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'pharmacy',
          payload: {
            legalName: data.get('legalName'),
            ...(optional('tradingName') ? { tradingName: optional('tradingName') } : {}),
            contactName: data.get('contactName'),
            contactEmail: data.get('contactEmail'),
            contactPhone,
            ...(optional('websiteUrl') ? { websiteUrl: optional('websiteUrl') } : {}),
            addressLine1: data.get('addressLine1'),
            ...(optional('addressLine2') ? { addressLine2: optional('addressLine2') } : {}),
            city: data.get('city'),
            state: data.get('state'),
            postalCode: data.get('postalCode'),
            statesServed,
            ...(optional('ncpdpId') ? { ncpdpId: optional('ncpdpId') } : {}),
            ...(optional('npi') ? { npi: optional('npi') } : {}),
            ...(optional('deaNumber') ? { deaNumber: optional('deaNumber') } : {}),
            dispensesCompounded: compounded,
            dispensesBranded: branded,
            isOutsourcingFacility: outsourcing,
            ...(optional('notes') ? { notes: optional('notes') } : {}),
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
        body="We will email you a link to upload your licences — one per state you ship into, plus FDA registration if you are a 503B. Then we will talk through your catalogue and how you would like to receive orders."
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-12">
      <Fieldset legend="The pharmacy">
        <Field label="Legal name" required className="sm:col-span-2">
          <Input name="legalName" required autoComplete="organization" />
        </Field>
        <Field label="Trading name" hint="If you operate under a different one.">
          <Input name="tradingName" />
        </Field>
        <Field label="Website">
          <Input name="websiteUrl" type="url" placeholder="https://" />
        </Field>
        <Field label="NCPDP ID">
          <Input name="ncpdpId" />
        </Field>
        <Field label="NPI" hint="Ten digits.">
          <Input name="npi" inputMode="numeric" pattern="\d{10}" />
        </Field>
        <Field label="DEA number">
          <Input name="deaNumber" />
        </Field>
      </Fieldset>

      <Fieldset legend="Who we should speak to">
        <Field label="Contact name" required>
          <Input name="contactName" required autoComplete="name" />
        </Field>
        <Field label="Email" required>
          <Input name="contactEmail" type="email" required autoComplete="email" />
        </Field>
        <Field label="Phone" hint="US number." required>
          <MaskedInput
            mask="phone"
            required
            aria-label="Phone"
            placeholder="(555) 123-4567"
            value={contactPhone}
            onValueChange={setContactPhone}
          />
        </Field>
      </Fieldset>

      <Fieldset legend="Address">
        <Field label="Address" required className="sm:col-span-2">
          <Input name="addressLine1" required autoComplete="address-line1" />
        </Field>
        <Field label="Address line 2" className="sm:col-span-2">
          <Input name="addressLine2" autoComplete="address-line2" />
        </Field>
        <Field label="City" required>
          <Input name="city" required autoComplete="address-level2" />
        </Field>
        <Field label="State" required>
          <Select name="state" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {US_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ZIP" required>
          <Input name="postalCode" required pattern="\d{5}(-\d{4})?" placeholder="78701" />
        </Field>
      </Fieldset>

      <Fieldset
        legend="What you dispense, and where"
        hint="These decide which prescriptions can be routed to you, so they are checked against your licences before anything goes live."
        columns={1}
      >
        <Field
          label="States you ship into"
          hint="Shipping outside your own state means we will ask for a non-resident licence for each."
          required
        >
          <StatePicker
            label="States you ship into"
            states={US_STATES}
            value={statesServed}
            onChange={setStatesServed}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox
            label="We dispense compounded products"
            checked={compounded}
            onChange={(event) => setCompounded(event.target.checked)}
          />
          <Checkbox
            label="We dispense branded products"
            checked={branded}
            onChange={(event) => setBranded(event.target.checked)}
          />
          <Checkbox
            label="We are a 503B outsourcing facility"
            hint="This adds an FDA registration to the documents we will need."
            checked={outsourcing}
            onChange={(event) => setOutsourcing(event.target.checked)}
          />
        </div>

        <Field label="Anything else we should know" hint="Your ordering system, lead times, questions.">
          <Textarea name="notes" rows={4} placeholder="e.g. we run LifeFile" />
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
          Licences are uploaded at the next step, not here.
        </p>
      </div>
    </form>
  );
}
