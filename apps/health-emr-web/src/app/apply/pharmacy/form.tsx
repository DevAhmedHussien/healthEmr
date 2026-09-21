'use client';

import * as React from 'react';
import {
  PHARMACY_DOCUMENT_LABELS,
  US_STATES,
  pharmacyApplicationSchema,
  type PharmacyApplicationInput,
} from '@health-emr/types';
import { Alert, Button, Card } from '@/components/ui/primitives';
import { Form } from '@/components/form/form';
import {
  CheckboxField,
  ChipsField,
  MaskedField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/form/fields';
import { Wizard, type WizardStep } from '@/components/form/wizard';
import { UploadStep } from '@/components/form/upload-step';
import { SendIcon } from '@/components/ui/icons';

const stateOptions = US_STATES.map((state) => ({ value: state, label: state }));

export function PharmacyApplicationForm() {
  const [errors, setErrors] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [applicationId, setApplicationId] = React.useState<string | null>(null);
  const [required, setRequired] = React.useState<string[]>([]);
  const [uploadCount, setUploadCount] = React.useState(0);
  const [finished, setFinished] = React.useState(false);

  if (finished) {
    return (
      <Alert tone="success">
        <p className="font-medium">Application received.</p>
        <p className="mt-1 text-[0.875rem]">
          Reference {applicationId?.slice(0, 8)}. We will check each licence and registration before
          anything is dispensed through you.
        </p>
      </Alert>
    );
  }

  return (
    <Form<PharmacyApplicationInput>
      schema={pharmacyApplicationSchema as never}
      defaultValues={{
        legalName: '',
        tradingName: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        websiteUrl: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '' as never,
        postalCode: '',
        statesServed: [],
        ncpdpId: '',
        npi: '',
        deaNumber: '',
        dispensesCompounded: false,
        dispensesBranded: false,
        isOutsourcingFacility: false,
        notes: '',
      }}
      onSubmit={() => setFinished(true)}
    >
      {(form) => {
        const submitApplication = async () => {
          setBusy(true);
          setErrors([]);
          try {
            const values = form.getValues();
            const response = await fetch('/api/bff/v1/public/onboarding/pharmacy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // Strip the empty optionals: the schema is strict, and an empty
              // string is not the same as an absent optional field.
              body: JSON.stringify(
                Object.fromEntries(
                  Object.entries(values).filter(([, value]) => value !== '' && value !== undefined),
                ),
              ),
            });
            const body = await response.json();
            if (!response.ok) throw body;

            setApplicationId(body.applicationId);
            setRequired(body.requiredDocuments);
          } catch (caught) {
            const detail = caught as { details?: Array<{ message: string }>; message?: string };
            setErrors(
              detail.details?.map((d) => d.message) ?? [detail.message ?? 'Something went wrong'],
            );
          } finally {
            setBusy(false);
          }
        };

        const steps: Array<WizardStep<PharmacyApplicationInput>> = [
          {
            id: 'business',
            title: 'The business',
            description: 'Who you are and how we reach you.',
            fields: ['legalName', 'contactName', 'contactEmail', 'contactPhone'],
            render: () => (
              <div className="grid gap-4 md:grid-cols-2">
                <TextField<PharmacyApplicationInput> name="legalName" label="Legal name" required />
                <TextField<PharmacyApplicationInput>
                  name="tradingName"
                  label="Trading name"
                  hint="If different"
                />
                <TextField<PharmacyApplicationInput>
                  name="contactName"
                  label="Contact name"
                  required
                />
                <TextField<PharmacyApplicationInput>
                  name="contactEmail"
                  label="Contact email"
                  type="email"
                  required
                />
                <MaskedField<PharmacyApplicationInput>
                  name="contactPhone"
                  label="Contact phone"
                  mask="phone"
                  placeholder="(555) 123-4567"
                  required
                />
                <TextField<PharmacyApplicationInput>
                  name="websiteUrl"
                  label="Website"
                  placeholder="https://"
                />
              </div>
            ),
          },
          {
            id: 'address',
            title: 'Where you are',
            description: 'Your licensed premises.',
            fields: ['addressLine1', 'city', 'state', 'postalCode'],
            render: () => (
              <div className="space-y-4">
                <TextField<PharmacyApplicationInput> name="addressLine1" label="Street" required />
                <div className="grid gap-4 md:grid-cols-3">
                  <TextField<PharmacyApplicationInput> name="city" label="City" required />
                  <SelectField<PharmacyApplicationInput>
                    name="state"
                    label="State"
                    options={stateOptions}
                    required
                  />
                  <MaskedField<PharmacyApplicationInput>
                    name="postalCode"
                    label="ZIP"
                    mask="zip"
                    placeholder="12345"
                    required
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'dispensing',
            title: 'What you dispense',
            description: 'This decides which documents we need from you.',
            fields: ['statesServed', 'dispensesCompounded', 'dispensesBranded'],
            render: () => (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <TextField<PharmacyApplicationInput> name="ncpdpId" label="NCPDP ID" />
                  <MaskedField<PharmacyApplicationInput>
                    name="npi"
                    label="NPI"
                    mask="npi"
                    placeholder="10 digits"
                  />
                  <TextField<PharmacyApplicationInput> name="deaNumber" label="DEA number" />
                </div>

                <div className="space-y-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-gray-50)] p-4">
                  <CheckboxField<PharmacyApplicationInput>
                    name="dispensesCompounded"
                    label="We dispense compounded products"
                  />
                  <CheckboxField<PharmacyApplicationInput>
                    name="dispensesBranded"
                    label="We dispense branded products"
                  />
                  <CheckboxField<PharmacyApplicationInput>
                    name="isOutsourcingFacility"
                    label="We are a 503B outsourcing facility"
                    hint="This adds an FDA registration to the documents we need"
                  />
                </div>

                <ChipsField<PharmacyApplicationInput>
                  name="statesServed"
                  label="States you can ship into"
                  hint="Shipping outside your own state means we will ask for a non-resident licence"
                  options={stateOptions}
                  columns={6}
                  required
                />

                <TextAreaField<PharmacyApplicationInput>
                  name="notes"
                  label="Anything else we should know"
                  rows={3}
                />
              </div>
            ),
          },
          {
            id: 'documents',
            title: 'Documents',
            description: 'The list below is built from what you just told us.',
            fields: [],
            canAdvance: () => uploadCount > 0,
            render: () => (
              <div className="space-y-4">
                {!applicationId ? (
                  <div className="space-y-3">
                    <p className="text-[0.9rem] text-[var(--ar-text-muted)]">
                      Save your details first, then attach your paperwork.
                    </p>
                    <Button
                      type="button"
                      icon={SendIcon}
                      onClick={submitApplication}
                      disabled={busy}
                    >
                      {busy ? 'Saving…' : 'Save and continue to upload'}
                    </Button>
                  </div>
                ) : (
                  <UploadStep
                    scope="pharmacy"
                    applicationId={applicationId}
                    required={required.map((kind) => ({
                      kind,
                      label:
                        PHARMACY_DOCUMENT_LABELS[kind as keyof typeof PHARMACY_DOCUMENT_LABELS] ??
                        kind,
                      perState:
                        kind === 'NONRESIDENT_PHARMACY_LICENSE' ||
                        kind === 'STATE_PHARMACY_LICENSE',
                    }))}
                    states={form.getValues('statesServed') ?? []}
                    onChange={(docs) => setUploadCount(docs.length)}
                  />
                )}
              </div>
            ),
          },
        ];

        return (
          <Card>
            {errors.length > 0 ? (
              <div className="mb-5">
                <Alert>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            ) : null}

            <Wizard<PharmacyApplicationInput>
              steps={steps}
              busy={busy}
              submitLabel="Finish"
              onSubmit={() => setFinished(true)}
            />
          </Card>
        );
      }}
    </Form>
  );
}
