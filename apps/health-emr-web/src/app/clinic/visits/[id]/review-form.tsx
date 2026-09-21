'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { Alert, Button } from '@/components/ui/primitives';
import { RxPadIcon } from '@/components/ui/icons';
import { Form } from '@/components/form/form';
import { SelectField, TextAreaField, TextField } from '@/components/form/fields';
import {
  ADMINISTRATION_ROUTES,
  ROUTES_NEEDING_SITE,
  composeSig,
  itemDecisionSchema,
  type AdministrationRoute,
  type DecideRequestInput,
} from '@health-emr/types';

interface Item {
  id: string;
  nameText: string;
  strength: string;
  quantity: string;
  /** What the patient asked for, offered as the default plan length. */
  daysSupply: number | null;
}

/**
 * The form's own shape, mapped onto the API contract.
 *
 * Every field is a string because that is what an input holds, and every
 * optional one arrives as `''` rather than absent. Stripping the empties before
 * the API schema runs is what makes the error say "Say how much to take each
 * time" instead of "String must contain at least 1 character(s)" — the contract
 * is unchanged, only the empties are normalised.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const lineSchema = z.preprocess((line) => {
  const row = (line ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, blankToUndefined(value)]),
  );
}, itemDecisionSchema);

const reviewSchema = z.object({
  items: z.array(lineSchema).min(1),
  note: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
});

type ReviewValues = {
  items: Array<{
    itemId: string;
    decision: 'APPROVED' | 'MODIFIED' | 'DENIED';
    dose: string;
    route: AdministrationRoute | '';
    site: string;
    frequency: string;
    daysSupply: string;
    sig: string;
    patientNote: string;
    approvedStrength: string;
    approvedQuantity: string;
    approvedRefills: string;
    reason: string;
  }>;
  note: string;
};

const DECISIONS = [
  { value: 'APPROVED', label: 'Approve as requested' },
  { value: 'MODIFIED', label: 'Approve with changes' },
  { value: 'DENIED', label: 'Refuse' },
];

const ROUTE_OPTIONS = ADMINISTRATION_ROUTES.map((value) => ({
  value,
  label: {
    SUBCUTANEOUS: 'Subcutaneous injection',
    INTRAMUSCULAR: 'Intramuscular injection',
    ORAL: 'By mouth',
    SUBLINGUAL: 'Under the tongue',
    TOPICAL: 'Applied to skin',
    NASAL: 'Nasal spray',
    OTHER: 'Other',
  }[value],
}));

/**
 * The decision form.
 *
 * Built on the same schema the API validates with, so a provider finds out
 * which field is wrong, next to that field, before submitting. It used to lean
 * on the browser's `required` attribute: the result was a "Please fill out this
 * field" tooltip with no indication of which of two long cards it belonged to,
 * and — if it got as far as the server — every message from every line
 * concatenated into one banner reading "Must be a whole number · Say how much
 * to take each time · Must be a whole number · …".
 */
export function ReviewForm({ visitId, items }: { visitId: string; items: Item[] }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  const defaults: ReviewValues = {
    items: items.map((item) => ({
      itemId: item.id,
      decision: 'APPROVED',
      /**
       * Deliberately blank.
       *
       * It used to prefill from the requested strength, which is the one thing
       * the contract warns against: the strength is the product — a 2.5mg/mL
       * vial — and the dose is what is drawn from it. Prefilling one with the
       * other put "2.5mg/mL" in a field meaning "how much each time", and a
       * clinician confirming rather than reading writes down a tenfold error.
       */
      dose: '',
      route: '',
      site: '',
      frequency: '',
      daysSupply: item.daysSupply ? String(item.daysSupply) : '',
      sig: '',
      patientNote: '',
      approvedStrength: '',
      approvedQuantity: '',
      approvedRefills: '',
      reason: '',
    })),
    note: '',
  };

  /**
   * The values arriving here are the *parsed* ones.
   *
   * The resolver has already run every field through the same schema the API
   * validates with, so blanks are `undefined` rather than `''` and the shape is
   * exactly `ItemDecisionInput[]`. Passing it straight through is not laziness:
   * the hand-written mapper this replaced re-derived the same object and called
   * `.trim()` on fields the resolver had already turned into `undefined`, which
   * threw before the request was ever made — a submit button that looked alive
   * and did nothing.
   */
  async function submit(values: DecideRequestInput) {
    setError(null);
    try {
      await api(`v1/clinic/visits/${visitId}/decide`, {
        method: 'POST',
        body: JSON.stringify(values),
      });

      router.push('/clinic');
      router.refresh();
    } catch (caught) {
      // The resolver catches everything the schema knows about, so anything
      // reaching here is a server-side refusal — a lapsed licence, a visit
      // somebody else already decided. Those are one message, not a list.
      setError(caught instanceof ApiError ? caught.message : (caught as Error).message);
    }
  }

  return (
    <Form<ReviewValues>
      schema={reviewSchema as never}
      defaultValues={defaults}
      onSubmit={submit as never}
    >
      {(form) => (
        <>
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {items.map((item, index) => (
            <LineCard key={item.id} item={item} index={index} />
          ))}

          <TextAreaField<ReviewValues>
            name="note"
            label="Note on this visit"
            hint="Recorded against the visit for whoever reads the chart next. Not sent to the patient."
            rows={2}
          />

          <div className="flex justify-end">
            <Button type="submit" icon={RxPadIcon} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing…' : 'Sign and submit'}
            </Button>
          </div>
        </>
      )}
    </Form>
  );
}

/** One medication, and what the clinician decided about it. */
function LineCard({ item, index }: { item: Item; index: number }) {
  const form = useFormContext<ReviewValues>();
  const line = useWatch({ control: form.control, name: `items.${index}` });

  const dispensing = line?.decision !== 'DENIED';
  const needsSite = Boolean(line?.route && ROUTES_NEEDING_SITE.includes(line.route));

  /**
   * The directions follow the fields until a clinician edits them.
   *
   * Composed with the same `composeSig` the server records, so what is signed
   * here is exactly what is stored — a second implementation would eventually
   * say something different from the label. Once touched it stops following,
   * because a clinician who reworded the label meant it.
   *
   * "Touched" is react-hook-form's own dirty tracking rather than a flag of our
   * own: `setValue` below leaves the field clean, and only a keystroke marks it
   * dirty, which is exactly the distinction needed.
   */
  const sigEdited = Boolean(form.formState.dirtyFields.items?.[index]?.sig);

  React.useEffect(() => {
    if (sigEdited || !dispensing || !line?.dose?.trim()) return;

    const composed = composeSig({
      dose: line.dose,
      route: line.route || undefined,
      site: line.site || undefined,
      frequency: line.frequency || undefined,
      daysSupply: line.daysSupply ? Number(line.daysSupply) : undefined,
    });

    if (composed !== line.sig) {
      form.setValue(`items.${index}.sig`, composed, { shouldValidate: false });
    }
  }, [
    sigEdited,
    dispensing,
    form,
    index,
    line?.dose,
    line?.route,
    line?.site,
    line?.frequency,
    line?.daysSupply,
    line?.sig,
  ]);

  return (
    <div className="rounded-xl border border-[var(--ar-border)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {item.nameText} <span className="text-[var(--ar-text-muted)]">{item.strength}</span>
        </p>
        <p className="text-[0.78rem] text-[var(--ar-text-faint)]">
          patient requested qty {item.quantity}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField<ReviewValues>
          name={`items.${index}.decision`}
          label="Decision"
          options={DECISIONS}
        />

        {dispensing ? (
          <TextField<ReviewValues>
            name={`items.${index}.dose`}
            label="Dose"
            required
            placeholder="e.g. 0.25mg"
            hint="How much is taken each time — not the strength of the vial it comes from."
          />
        ) : null}
      </div>

      {dispensing ? (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <SelectField<ReviewValues>
              name={`items.${index}.route`}
              label="How is it taken?"
              required
              placeholder="Select a route"
              options={ROUTE_OPTIONS}
            />
            <TextField<ReviewValues>
              name={`items.${index}.frequency`}
              label="How often?"
              required
              placeholder="e.g. once weekly"
            />
            <TextField<ReviewValues>
              name={`items.${index}.daysSupply`}
              label="Plan length"
              placeholder="e.g. 28"
              hint="Days this supply covers. Whole number."
            />
          </div>

          {needsSite ? (
            <div className="mt-4">
              <TextField<ReviewValues>
                name={`items.${index}.site`}
                label="Where on the body?"
                required
                placeholder="e.g. the abdomen, rotating sites"
                hint="This is the instruction patients most often get wrong."
              />
            </div>
          ) : null}

          <div className="mt-4">
            <TextAreaField<ReviewValues>
              name={`items.${index}.sig`}
              label="Directions for use"
              rows={2}
              hint="Written from the fields above. Edit it if you want different wording."
            />
          </div>

          <div className="mt-4">
            <TextAreaField<ReviewValues>
              name={`items.${index}.patientNote`}
              label="Note to the patient"
              rows={2}
              hint="Sent to them in chat the moment you sign. Not printed on the label."
            />
          </div>
        </>
      ) : null}

      {line?.decision === 'MODIFIED' ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextField<ReviewValues>
            name={`items.${index}.approvedStrength`}
            label="Strength dispensed"
            hint="Leave blank to keep what was requested."
          />
          <TextField<ReviewValues>
            name={`items.${index}.approvedQuantity`}
            label="Quantity"
            hint="Whole number."
          />
          <TextField<ReviewValues>
            name={`items.${index}.approvedRefills`}
            label="Refills"
            hint="Whole number."
          />
        </div>
      ) : null}

      {line?.decision !== 'APPROVED' ? (
        <div className="mt-4">
          <TextAreaField<ReviewValues>
            name={`items.${index}.reason`}
            label={line?.decision === 'DENIED' ? 'Why are you refusing?' : 'What changed, and why?'}
            required
            rows={2}
            hint="Goes to the client business and onto the record. The patient sees a plainer version."
          />
        </div>
      ) : null}
    </div>
  );
}
