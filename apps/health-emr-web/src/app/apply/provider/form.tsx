'use client';

import * as React from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import {
  PROVIDER_DOCUMENT_LABELS,
  US_STATES,
  providerApplicationSchema,
  type ProviderApplicationInput,
} from '@health-emr/types';
import { Alert, Button, Card } from '@/components/ui/primitives';
import { Form } from '@/components/form/form';
import { MaskedField, SelectField, TextAreaField, TextField } from '@/components/form/fields';
import { MultiSelect } from '@/components/ui/multi-select';
import { Field } from '@/components/ui/primitives';
import { Wizard, type WizardStep } from '@/components/form/wizard';
import { UploadStep } from '@/components/form/upload-step';
import { SendIcon, TrashIcon } from '@/components/ui/icons';

const stateOptions = US_STATES.map((state) => ({ value: state, label: state }));

/** Licences repeat, so they get their own array editor rather than fixed fields. */
function LicenceRows() {
  const { control, watch } = useFormContext<ProviderApplicationInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'licenses' });
  const licences = watch('licenses') ?? [];

  return (
    <div className="space-y-4">
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4"
        >
          <div className="grid gap-3 md:grid-cols-[130px_1fr_180px]">
            <SelectField<ProviderApplicationInput>
              name={`licenses.${index}.state`}
              label="State"
              options={stateOptions}
              required
            />
            <TextField<ProviderApplicationInput>
              name={`licenses.${index}.licenseNumber`}
              label="Licence number"
              required
            />
            <MaskedField<ProviderApplicationInput>
              name={`licenses.${index}.expiresAt`}
              label="Expires"
              mask="dateISO"
              placeholder="YYYY-MM-DD"
              required
            />
          </div>
          {fields.length > 1 ? (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={TrashIcon}
                onClick={() => remove(index)}
              >
                Remove {licences[index]?.state || 'this state'}
              </Button>
            </div>
          ) : null}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ state: '' as never, licenseNumber: '', expiresAt: '' })}
      >
        Add another state
      </Button>

      <p className="text-[0.78rem] text-[var(--ar-text-faint)]">
        Routing depends entirely on these. A patient in Texas is only ever offered to a clinician
        holding a current Texas licence.
      </p>
    </div>
  );
}

export function ProviderApplicationForm() {
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
          Reference {applicationId?.slice(0, 8)}. We will verify each licence against its document
          and be in touch. Nothing is approved until a person has checked the paperwork.
        </p>
      </Alert>
    );
  }

  return (
    <Form<ProviderApplicationInput>
      schema={providerApplicationSchema as never}
      defaultValues={{
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        credentials: '',
        npi: '',
        deaNumber: '',
        specialties: [],
        bio: '',
        requestedCategorySlugs: [],
        licenses: [{ state: '' as never, licenseNumber: '', expiresAt: '' }],
      }}
      onSubmit={() => setFinished(true)}
    >
      {(form) => {
        const submitApplication = async () => {
          setBusy(true);
          setErrors([]);
          try {
            const response = await fetch('/api/bff/v1/public/onboarding/provider', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(form.getValues()),
            });
            const body = await response.json();
            if (!response.ok) throw body;

            setApplicationId(body.applicationId);
            setRequired(body.requiredDocuments);
            return true;
          } catch (caught) {
            const detail = caught as { details?: Array<{ message: string }>; message?: string };
            setErrors(
              detail.details?.map((d) => d.message) ?? [detail.message ?? 'Something went wrong'],
            );
            return false;
          } finally {
            setBusy(false);
          }
        };

        const steps: Array<WizardStep<ProviderApplicationInput>> = [
          {
            id: 'about',
            title: 'About you',
            description: 'How we reach you, and what you are licensed to do.',
            fields: ['firstName', 'lastName', 'email', 'phone', 'credentials', 'npi'],
            render: () => (
              <div className="grid gap-4 md:grid-cols-2">
                <TextField<ProviderApplicationInput> name="firstName" label="First name" required />
                <TextField<ProviderApplicationInput> name="lastName" label="Last name" required />
                <TextField<ProviderApplicationInput>
                  name="email"
                  label="Email"
                  type="email"
                  required
                />
                <MaskedField<ProviderApplicationInput>
                  name="phone"
                  label="Phone"
                  mask="phone"
                  placeholder="(555) 123-4567"
                  required
                />
                <TextField<ProviderApplicationInput>
                  name="credentials"
                  label="Credentials"
                  hint="MD, DO, NP, PA"
                  required
                />
                <MaskedField<ProviderApplicationInput>
                  name="npi"
                  label="NPI"
                  mask="npi"
                  placeholder="10 digits"
                  required
                />
                <TextField<ProviderApplicationInput>
                  name="deaNumber"
                  label="DEA number"
                  hint="Optional"
                />
              </div>
            ),
          },
          {
            id: 'licences',
            title: 'State licences',
            description:
              'One row per state. An expired licence, or a state listed twice, is rejected.',
            fields: ['licenses'],
            render: () => <LicenceRows />,
          },
          {
            id: 'background',
            title: 'What you treat',
            description: 'This decides which visits reach your queue.',
            fields: ['requestedCategorySlugs', 'bio'],
            render: () => (
              <div className="space-y-4">
                <TreatmentAreas />
                <TextAreaField<ProviderApplicationInput>
                  name="bio"
                  label="Short bio"
                  hint="A few sentences on your practice"
                  rows={5}
                />
              </div>
            ),
          },
          {
            id: 'documents',
            title: 'Documents',
            description: 'Upload as you go. We cannot approve an application without them.',
            fields: [],
            canAdvance: () => uploadCount > 0,
            render: () => (
              <div className="space-y-4">
                {!applicationId ? (
                  <div className="space-y-3">
                    <p className="text-[0.9rem] text-[var(--ar-text-muted)]">
                      Save your details first, then attach your documents.
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
                    scope="provider"
                    applicationId={applicationId}
                    required={required.map((kind) => ({
                      kind,
                      label:
                        PROVIDER_DOCUMENT_LABELS[kind as keyof typeof PROVIDER_DOCUMENT_LABELS] ??
                        kind,
                      perState: kind === 'STATE_MEDICAL_LICENSE',
                    }))}
                    states={(form.getValues('licenses') ?? [])
                      .map((licence) => licence.state)
                      .filter(Boolean)}
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

            <Wizard<ProviderApplicationInput>
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

/**
 * The treatment areas a clinician is asking to cover.
 *
 * Previously missing from the form entirely, which is why every application
 * arrived with "Categories requested: —" and routing had nothing to go on. The
 * list is fetched rather than hardcoded so a category added to the platform
 * appears here without a deploy.
 */
function TreatmentAreas() {
  const { watch, setValue, formState } = useFormContext<ProviderApplicationInput>();
  const [options, setOptions] = React.useState<Array<{ value: string; label: string }>>([]);
  const chosen = (watch('requestedCategorySlugs') ?? []) as string[];

  React.useEffect(() => {
    fetch('/api/bff/v1/public/onboarding/categories')
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((body: { data: Array<{ slug: string; name: string }> }) =>
        setOptions(body.data.map((row) => ({ value: row.slug, label: row.name }))),
      )
      .catch(() => setOptions([]));
  }, []);

  const error = formState.errors.requestedCategorySlugs?.message as string | undefined;

  return (
    <Field
      label="Treatment areas"
      hint="Pick everything you are comfortable prescribing for. You can change this later."
      error={error}
    >
      <MultiSelect
        value={chosen.join(',')}
        onValueChange={(value) =>
          setValue('requestedCategorySlugs', value ? (value.split(',') as never) : ([] as never), {
            shouldValidate: true,
            shouldDirty: true,
          })
        }
        options={options}
        placeholder="Select the areas you cover"
        searchPlaceholder="Filter treatments…"
        aria-label="Treatment areas"
      />
    </Field>
  );
}
