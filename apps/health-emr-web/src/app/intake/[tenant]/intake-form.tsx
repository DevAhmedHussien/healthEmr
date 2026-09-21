'use client';

import * as React from 'react';
import type { Question, Questionnaire } from '@health-emr/types';
import { US_STATES } from '@health-emr/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { SimpleSelect } from '@/components/ui/select';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  SendIcon,
  UploadIcon,
} from '@/components/ui/icons';
import {
  Answers,
  QuestionField,
  answerQuestion,
  disqualification,
  toQaPairs,
  visibleQuestions,
} from './questionnaire-step';

interface Kit {
  /** What an order is placed with. Not the pharmacy's own kit code. */
  medId: string;
  name: string;
  favouriteName: string;
  strength: string | null;
  form: string;
  vialSize: string | null;
  daysSupply: number | null;
  dispenseQuantity: string | null;
  dispenseUnit: string | null;
  refills: number | null;
  category: string;
  /** The visit types this product may be ordered under, follow-ups included. */
  visitTypes: string[];
}

interface Pharmacy {
  pharmacyId: string;
  name: string;
  isDefault: boolean;
}

/**
 * A step is one screen, and one screen asks one thing.
 *
 * The clinical intakes this replaces work this way, and they get finished: a
 * page of twenty fields is abandoned, twenty pages of one field are not,
 * because each one looks like almost no work. The questionnaire is expanded
 * into a step per question rather than rendered as a block.
 */
type Step =
  | { id: string; kind: 'greeting' }
  | { id: string; kind: 'you' }
  | { id: string; kind: 'health' }
  | { id: string; kind: 'question'; question: Question }
  | { id: string; kind: 'treatment' }
  | { id: string; kind: 'photo' }
  | { id: string; kind: 'review' };

/**
 * The intake a patient fills in.
 *
 * The questions come from the category's template, so this form is the same
 * component whichever treatment somebody is asking about — and a new category
 * needs no code. What it collects is exactly the payload the platform accepts,
 * so a visit created here is indistinguishable from one a client posts itself.
 *
 * The photograph is sent after the visit exists, against the id it returns. That
 * is the contract, and it is also the right shape: several megabytes of base64
 * inside the call that creates a patient makes a retry expensive.
 */
export function IntakeForm({ tenant, visitType }: { tenant: string; visitType: string }) {
  const [step, setStep] = React.useState(0);
  const [questionnaire, setQuestionnaire] = React.useState<Questionnaire | null>(null);
  const [categoryName, setCategoryName] = React.useState('');
  const [pharmacies, setPharmacies] = React.useState<Pharmacy[]>([]);
  const [kits, setKits] = React.useState<Kit[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [patient, setPatient] = React.useState({
    firstName: '',
    lastName: '',
    dob: '',
    sex: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
  });
  const [health, setHealth] = React.useState({
    allergies: '',
    medicalConditions: '',
    selfReportedMeds: '',
  });
  const [answers, setAnswers] = React.useState<Answers>({});
  /**
   * Derived, not stored.
   *
   * It is a pure function of the answers, and keeping a copy in state meant one
   * render where the answer had changed and the block had not — long enough to
   * press Continue.
   */
  const blocked = React.useMemo(
    () => (questionnaire ? disqualification(questionnaire, answers) : null),
    [questionnaire, answers],
  );
  const [pharmacyId, setPharmacyId] = React.useState('');
  /**
   * What the patient is asking for, and what they paid us for it.
   *
   * A list rather than one choice: a weight-loss order routinely carries the
   * GLP-1 and an antiemetic alongside it, and a form that can only express one
   * of them cannot produce the visit those patients actually send.
   *
   * The price is per line and in whole dollars here, converted to cents at the
   * boundary. It is the client business's own retail price — what the patient
   * paid them, not what we charge — and without it the client's margin shows as
   * unknown rather than as zero.
   */
  const [basket, setBasket] = React.useState<Array<{ medId: string; price: string }>>([]);
  const [picking, setPicking] = React.useState('');
  const [photo, setPhoto] = React.useState<{ mime: string; data: string; name: string } | null>(
    null,
  );
  const [consent, setConsent] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ visitId: string; photoStored: boolean } | null>(null);

  const call = React.useCallback(
    async (path: string) => {
      const response = await fetch(`/api/intake/${tenant}?path=${encodeURIComponent(path)}`);
      const payload = await response.json();
      if (!response.ok || payload.status !== 200) {
        throw new Error(payload.error ?? 'Could not load the form.');
      }
      return payload.data;
    },
    [tenant],
  );

  React.useEffect(() => {
    Promise.all([call(`questionnaire/${visitType}`), call('pharmacies')])
      .then(([q, p]) => {
        setQuestionnaire(q.questionnaire);
        setCategoryName(q.category.name);
        setPharmacies(p);
        const preferred = p.find((row: Pharmacy) => row.isDefault) ?? p[0];
        if (preferred) setPharmacyId(preferred.pharmacyId);
      })
      .catch((cause: Error) => setLoadError(cause.message));
  }, [call, visitType]);

  React.useEffect(() => {
    if (!pharmacyId) return;
    setKits([]);
    setBasket([]);
    setPicking('');
    call(`pharmacies/${pharmacyId}/medications`)
      // Only what this visit is about. A pharmacy's full list spans every
      // treatment it compounds, and offering a weight-loss patient an
      // anti-nausea tablet is a question a clinician then has to unpick.
      .then((rows: Kit[]) => setKits(rows.filter((row) => row.visitTypes.includes(visitType))))
      .catch(() => setKits([]));
  }, [pharmacyId, call, visitType]);

  /**
   * Height and weight, read back as a BMI.
   *
   * Shown because it is the number the treatment actually turns on, and a
   * patient who sees it understands the questions that follow. Derived from
   * whatever the template happened to call the two fields — matched by `kind`,
   * not by id, so it keeps working when a category names them differently.
   */
  const bmi = React.useMemo(() => {
    const byKind = (kind: 'height' | 'weight') =>
      questionnaire?.questions.find((question) => question.kind === kind)?.id;

    const heightRaw = answers[byKind('height') ?? ''] ?? '';
    const weightRaw = answers[byKind('weight') ?? ''] ?? '';

    const feetInches = /^(\d)[^\d]+(\d{1,2})/.exec(heightRaw.trim());
    const pounds = Number.parseFloat(weightRaw.replace(/[^\d.]/g, ''));
    if (!feetInches || !Number.isFinite(pounds) || pounds <= 0) return null;

    const inches = Number(feetInches[1]) * 12 + Number(feetInches[2]);
    if (!inches) return null;

    const value = (703 * pounds) / (inches * inches);
    const label =
      value < 18.5
        ? 'under the healthy range'
        : value < 25
          ? 'in the healthy range'
          : value < 30
            ? 'overweight'
            : 'obese';

    return { value: value.toFixed(1), label };
  }, [questionnaire, answers]);

  const needsPhoto = questionnaire?.requiresPhotoId ?? false;

  const steps: Step[] = React.useMemo(
    () => [
      { id: 'greeting', kind: 'greeting' },
      { id: 'you', kind: 'you' },
      { id: 'health', kind: 'health' },
      ...(questionnaire ? visibleQuestions(questionnaire, answers) : []).map((question): Step => ({
        id: `q:${question.id}`,
        kind: 'question',
        question,
      })),
      { id: 'treatment', kind: 'treatment' },
      ...(needsPhoto ? [{ id: 'photo', kind: 'photo' as const }] : []),
      { id: 'review', kind: 'review' },
    ],
    [questionnaire, answers, needsPhoto],
  );

  const current = steps[Math.min(step, steps.length - 1)];

  /**
   * Anchor the position by step id, not by index.
   *
   * Answering a branching question adds or removes steps. The same numeric
   * index then points at a different screen — which silently skips whatever
   * moved into the gap, and the patient never sees a question we were required
   * to ask.
   */

  /**
   * Anchor the position by step id, but only when the list itself changed.
   *
   * Answering a branching question adds or removes steps, and the same numeric
   * index then points at a different screen — which silently skips whatever
   * moved into the gap, so the patient never sees a question we were required
   * to ask.
   *
   * Comparing the array's identity is what separates that from an ordinary
   * Continue. An earlier version realigned whenever the id changed, which is
   * true of every deliberate navigation too, so it dragged the patient back to
   * the step they had just left.
   */
  const seenSteps = React.useRef(steps);
  const anchoredId = React.useRef<string | null>(null);

  React.useLayoutEffect(() => {
    if (seenSteps.current !== steps) {
      const wanted = anchoredId.current;
      seenSteps.current = steps;

      if (wanted) {
        const moved = steps.findIndex((candidate) => candidate.id === wanted);
        if (moved >= 0 && moved !== step) {
          setStep(moved);
          return;
        }
      }
    }

    anchoredId.current = current?.id ?? null;
  }, [steps, current?.id, step]);

  if (loadError) {
    return (
      <Card>
        <Alert tone="danger">{loadError}</Alert>
      </Card>
    );
  }

  if (!questionnaire) {
    return (
      <Card className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="text-center">
        <CheckCircleIcon size={40} className="mx-auto text-[var(--ar-on-success)]" />
        <h2 className="mt-3">Thank you — that is with a clinician now.</h2>
        <p className="mx-auto mt-2 max-w-lg text-[0.92rem] leading-relaxed text-[var(--ar-text-muted)]">
          A licensed clinician will review what you have told us and decide whether this treatment
          is right for you. You will hear from us either way. If they approve it, it goes straight
          to the pharmacy.
        </p>
        <p className="mt-4 text-[0.8rem] text-[var(--ar-text-faint)]">
          Your reference is <code className="tabular-nums">{done.visitId.slice(0, 8)}</code>
          {done.photoStored ? ' · your ID was received' : ''}
        </p>
      </Card>
    );
  }

  const problems = (): string[] => {
    if (current.kind === 'you') {
      return [
        !patient.firstName && 'your first name',
        !patient.lastName && 'your last name',
        // Either separator: the field shows dashes, and a pasted date may use
        // slashes. The API accepts both and normalises.
        !/^(0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])[-/](19|20)\d{2}$/.test(patient.dob) &&
          'your date of birth',
        !patient.sex && 'sex assigned at birth',
        patient.phone.length !== 10 && 'a 10-digit mobile number',
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patient.email) && 'a valid email',
        !patient.address && 'your address',
        !patient.city && 'your city',
        !patient.state && 'your state',
        patient.zip.length !== 5 && 'a 5-digit ZIP',
      ].filter(Boolean) as string[];
    }
    if (current.kind === 'health') {
      return [
        !health.allergies && 'your allergies (write “None” if you have none)',
        !health.medicalConditions && 'your medical conditions (write “None” if you have none)',
        !health.selfReportedMeds && 'the medications you take (write “None” if you take none)',
      ].filter(Boolean) as string[];
    }
    if (current.kind === 'question') {
      const answered = (answers[current.question.id] ?? '').trim();
      return current.question.required && !answered ? ['an answer to this question'] : [];
    }
    if (current.kind === 'treatment') {
      return [!pharmacyId && 'a pharmacy', basket.length === 0 && 'at least one treatment'].filter(
        Boolean,
      ) as string[];
    }
    if (current.kind === 'photo') {
      return photo ? [] : ['a photo of your ID'];
    }
    if (current.kind === 'review') {
      return consent ? [] : ['your consent to be treated'];
    }
    // The greeting asks for nothing, so it must not inherit the review's gate.
    return [];
  };

  const missing = problems();
  const canContinue = missing.length === 0 && !blocked;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const lines = basket
        .map((line) => ({ line, kit: kits.find((kit) => kit.medId === line.medId) }))
        .filter((entry) => entry.kit);
      const visitResponse = await fetch(`/api/intake/${tenant}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'visit/createNoPayPhotos',
          body: {
            masterId: `${tenant}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            company: tenant,
            visitType,
            pharmacyId,
            formObj: {
              consentsSigned: true,
              ...patient,
              ...health,
              ...toQaPairs(questionnaire!, answers),
              patientPreference: lines.map(({ line, kit }) => ({
                name: kit!.name,
                strength: kit!.strength ?? '—',
                // What the pharmacy actually dispenses for this product, not a
                // guess. A clinician can still change any of it.
                quantity: kit!.dispenseQuantity ?? '1',
                refills: String(kit!.refills ?? 0),
                ...(kit!.daysSupply ? { daysSupply: String(kit!.daysSupply) } : {}),
                medId: line.medId,
                // Whole dollars in the field, integer cents on the wire. Money
                // is never a float on this boundary.
                ...(line.price.trim()
                  ? { patientPaidCents: Math.round(Number(line.price) * 100) }
                  : {}),
              })),
            },
          },
        }),
      });

      const visit = await visitResponse.json();
      if (!visitResponse.ok || visit.status !== 200) {
        throw new Error(visit.error ?? 'We could not submit that. Please check your answers.');
      }

      const visitId: string = visit.data.visitId;
      let photoStored = false;

      if (photo) {
        const photoResponse = await fetch(`/api/intake/${tenant}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'visit/photos',
            body: { visitId, images: [{ mime: photo.mime, data: photo.data }], kind: 'ID_PHOTO' },
          }),
        });
        photoStored = photoResponse.ok;
      }

      setDone({ visitId, photoStored });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-4"
      // Enter advances, the way a form with one question per screen should. On
      // the container rather than the window: it should only do this while the
      // form has focus, and a textarea still needs Enter for what Enter is for.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || busy) return;

        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
        if (!canContinue || current.kind === 'review') return;

        event.preventDefault();
        setStep((value) => value + 1);
      }}
    >
      {/* A bar, not a chip per step. The questionnaire expands to as many
          steps as the template has questions, and twenty chips wrap into four
          lines that tell the reader nothing. A bar and a count tell them the
          one thing they want to know: how much is left. */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[0.8rem] font-medium text-[var(--ar-headings)]">{categoryName}</p>
          <p className="text-[0.78rem] tabular-nums text-[var(--ar-text-faint)]">
            Step {step + 1} of {steps.length}
          </p>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ar-gray-200)]"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
          aria-label="Progress through the form"
        >
          <div
            className="h-full rounded-full bg-[var(--ar-primary)] transition-[width] duration-300"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <Card>
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        {current.kind === 'you' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <Input
                value={patient.firstName}
                onChange={(e) => setPatient({ ...patient, firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name">
              <Input
                value={patient.lastName}
                onChange={(e) => setPatient({ ...patient, lastName: e.target.value })}
              />
            </Field>
            <Field label="Date of birth" hint="You must be 18 or older.">
              <MaskedInput
                mask="dateUS"
                value={patient.dob}
                onValueChange={(raw) => setPatient({ ...patient, dob: raw })}
              />
            </Field>
            <Field label="Sex assigned at birth" hint="Used for clinical decisions, not identity.">
              <SimpleSelect
                value={patient.sex}
                onValueChange={(value) => setPatient({ ...patient, sex: value })}
                placeholder="Choose one"
                options={[
                  { value: 'Female', label: 'Female' },
                  { value: 'Male', label: 'Male' },
                ]}
              />
            </Field>
            <Field label="Mobile number" hint="We text you when there is an update.">
              <MaskedInput
                mask="phone"
                value={patient.phone}
                onValueChange={(raw) => setPatient({ ...patient, phone: raw })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={patient.email}
                onChange={(e) => setPatient({ ...patient, email: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" hint="Where the medication should be delivered.">
                <Input
                  value={patient.address}
                  onChange={(e) => setPatient({ ...patient, address: e.target.value })}
                />
              </Field>
            </div>
            <Field label="City">
              <Input
                value={patient.city}
                onChange={(e) => setPatient({ ...patient, city: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" hint="Where you are.">
                <SimpleSelect
                  value={patient.state}
                  onValueChange={(value) => setPatient({ ...patient, state: value })}
                  placeholder="State"
                  options={US_STATES.map((state) => ({ value: state, label: state }))}
                />
              </Field>
              <Field label="ZIP">
                <MaskedInput
                  mask="zip"
                  value={patient.zip}
                  onValueChange={(raw) => setPatient({ ...patient, zip: raw })}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {current.kind === 'health' ? (
          <div className="grid gap-4">
            <p className="max-w-2xl text-[0.9rem] text-[var(--ar-text-muted)]">
              A clinician reads all of this. If something does not apply, write “None” rather than
              leaving it blank — a blank answer tells them nothing.
            </p>
            <Field label="Allergies" hint="Medications, foods, anything.">
              <Textarea
                rows={2}
                value={health.allergies}
                onChange={(e) => setHealth({ ...health, allergies: e.target.value })}
              />
            </Field>
            <Field label="Medical conditions" hint="Anything you have been diagnosed with.">
              <Textarea
                rows={2}
                value={health.medicalConditions}
                onChange={(e) => setHealth({ ...health, medicalConditions: e.target.value })}
              />
            </Field>
            <Field label="Medications you take" hint="Including anything over the counter.">
              <Textarea
                rows={2}
                value={health.selfReportedMeds}
                onChange={(e) => setHealth({ ...health, selfReportedMeds: e.target.value })}
              />
            </Field>
          </div>
        ) : null}

        {current.kind === 'greeting' ? (
          <div className="py-2 text-center">
            <h2 className="mx-auto max-w-2xl">{questionnaire.title}</h2>
            {questionnaire.intro ? (
              <p className="mx-auto mt-3 max-w-xl text-[0.95rem] leading-relaxed text-[var(--ar-text-muted)]">
                {questionnaire.intro}
              </p>
            ) : null}
            <p className="mx-auto mt-4 max-w-xl text-[0.85rem] leading-relaxed text-[var(--ar-text-faint)]">
              A licensed clinician reads every answer before deciding. It takes a few minutes, and
              you can go back and change anything before you send it.
            </p>
          </div>
        ) : null}

        {current.kind === 'question' ? (
          <div className="space-y-4">
            {/* Keyed by question id so React remounts between steps.
                Without it the same select instance is reused, and Radix keeps
                showing the previous question's choice while the new answer is
                empty — a screen that looks answered and refuses to continue. */}
            <QuestionField
              key={current.question.id}
              question={current.question}
              value={answers[current.question.id] ?? ''}
              onChange={(value) =>
                setAnswers(answerQuestion(questionnaire, answers, current.question, value))
              }
            />
            {bmi ? (
              <p className="text-[0.82rem] text-[var(--ar-text-muted)]">
                That puts your BMI at{' '}
                <strong className="text-[var(--ar-headings)]">{bmi.value}</strong> ({bmi.label}).
              </p>
            ) : null}
          </div>
        ) : null}

        {current.kind === 'treatment' ? (
          <div className="grid gap-4">
            <Field
              label="Pharmacy"
              hint="Where your prescription would be filled and shipped from."
            >
              <SimpleSelect
                value={pharmacyId}
                onValueChange={setPharmacyId}
                placeholder="Choose a pharmacy"
                options={pharmacies.map((pharmacy) => ({
                  value: pharmacy.pharmacyId,
                  label: pharmacy.name,
                }))}
              />
            </Field>
            <Field
              label="Treatment you are asking about"
              hint="A clinician decides what is actually prescribed — this is what you would prefer. Add as many as the order carries."
            >
              <div className="flex gap-2">
                <SimpleSelect
                  value={picking}
                  onValueChange={setPicking}
                  className="flex-1"
                  placeholder={
                    kits.length ? 'Choose a treatment' : 'Nothing available at that pharmacy'
                  }
                  disabled={!kits.length}
                  options={kits
                    // Already in the basket. Offering it again produces two
                    // lines of the same medication on one visit.
                    .filter((kit) => !basket.some((line) => line.medId === kit.medId))
                    .map((kit) => ({
                      value: kit.medId,
                      label: kit.name,
                      hint: [
                        kit.strength,
                        kit.vialSize,
                        kit.daysSupply ? `${kit.daysSupply}-day supply` : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!picking}
                  onClick={() => {
                    setBasket((current) => [...current, { medId: picking, price: '' }]);
                    setPicking('');
                  }}
                >
                  Add
                </Button>
              </div>
            </Field>

            {basket.length ? (
              <ul className="grid gap-2">
                {basket.map((line) => {
                  const kit = kits.find((row) => row.medId === line.medId);
                  return (
                    <li
                      key={line.medId}
                      className="flex flex-wrap items-center gap-3 rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-[var(--ar-headings)]">
                          {kit?.name ?? line.medId}
                        </span>
                        <span className="block text-[0.78rem] text-[var(--ar-text-faint)]">
                          {[
                            kit?.strength,
                            kit?.vialSize,
                            kit?.daysSupply && `${kit.daysSupply}-day supply`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>

                      <label className="flex items-center gap-2 text-[0.8rem] text-[var(--ar-text-muted)]">
                        What you paid
                        <span className="relative">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ar-text-faint)]">
                            $
                          </span>
                          <Input
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label={`What you paid for ${kit?.name ?? line.medId}`}
                            value={line.price}
                            onChange={(event) =>
                              setBasket((current) =>
                                current.map((row) =>
                                  row.medId === line.medId
                                    ? // Digits and one decimal point. A price is
                                      // not a place for free text.
                                      { ...row, price: event.target.value.replace(/[^\d.]/g, '') }
                                    : row,
                                ),
                              )
                            }
                            className="w-28 pl-6"
                          />
                        </span>
                      </label>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${kit?.name ?? line.medId}`}
                        onClick={() =>
                          setBasket((current) => current.filter((row) => row.medId !== line.medId))
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}

        {current.kind === 'photo' ? (
          <div className="grid gap-4">
            <p className="max-w-2xl text-[0.9rem] text-[var(--ar-text-muted)]">
              A clinician has to confirm you are who you say you are before prescribing. A photo of
              your driving licence or passport is enough — held securely and seen only by the
              clinician reviewing your visit.
            </p>
            <label className="flex cursor-pointer items-center justify-center gap-2.5 rounded-[var(--ar-radius)] border-2 border-dashed border-[var(--ar-border)] px-6 py-10 text-[0.9rem] text-[var(--ar-text-muted)] transition hover:border-[var(--ar-primary)] hover:text-[var(--ar-primary)]">
              <UploadIcon size={18} />
              {photo ? photo.name : 'Choose a photo of your ID'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/heic,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () =>
                    setPhoto({
                      mime: file.type,
                      data: String(reader.result).split('base64,').pop() ?? '',
                      name: file.name,
                    });
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {photo ? <Badge tone="success">{photo.name} ready to send</Badge> : null}
          </div>
        ) : null}

        {current.kind === 'review' ? (
          <div className="grid gap-4">
            <h3 className="text-[1.05rem] font-medium text-[var(--ar-headings)]">
              Check this over
            </h3>
            <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <Line term="Name" value={`${patient.firstName} ${patient.lastName}`} />
              <Line term="Date of birth" value={patient.dob} />
              <Line term="Contact" value={`${patient.phone} · ${patient.email}`} />
              <Line
                term="Deliver to"
                value={`${patient.address}, ${patient.city}, ${patient.state} ${patient.zip}`}
              />
              <Line
                term="Asking about"
                value={basket
                  .map((line) => {
                    const kit = kits.find((row) => row.medId === line.medId);
                    const name = kit?.name ?? line.medId;
                    return line.price.trim() ? `${name} ($${line.price})` : name;
                  })
                  .join(', ')}
              />
              <Line
                term="Pharmacy"
                value={pharmacies.find((p) => p.pharmacyId === pharmacyId)?.name ?? pharmacyId}
              />
              <Line term="Allergies" value={health.allergies} />
              <Line term="Conditions" value={health.medicalConditions} />
            </dl>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-body-bg)] px-4 py-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1"
              />
              <span className="text-[0.85rem] leading-relaxed text-[var(--ar-text-muted)]">
                Everything I have entered is true and complete. I consent to being assessed and, if
                appropriate, treated by a licensed clinician without an in-person visit, and I
                understand they may decline if this treatment is not right for me.
              </span>
            </label>
          </div>
        ) : null}

        {blocked ? (
          <div className="mt-4">
            <Alert tone="danger">
              <strong>We cannot continue.</strong> {blocked} If you think this is wrong, or you need
              care today, please contact your own doctor or call 911 in an emergency.
            </Alert>
          </div>
        ) : null}

        {missing.length && !blocked ? (
          <div className="mt-4 flex gap-2.5 rounded-[var(--ar-radius)] bg-[var(--ar-warning-soft)] px-3.5 py-3">
            <AlertTriangleIcon size={16} className="mt-0.5 flex-none text-[var(--ar-on-warning)]" />
            <p className="text-[0.82rem] leading-relaxed text-[#8A4B0A]">
              Still needed: {missing.join(', ')}.
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            icon={ArrowLeftIcon}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || busy}
          >
            Back
          </Button>

          {step === steps.length - 1 ? (
            <Button icon={SendIcon} onClick={submit} disabled={!canContinue || busy}>
              {busy ? 'Sending…' : 'Submit to a clinician'}
            </Button>
          ) : (
            <Button
              iconAfter={ArrowRightIcon}
              onClick={() => setStep((value) => value + 1)}
              disabled={!canContinue}
            >
              Continue
            </Button>
          )}
        </div>
      </Card>

      <p className="text-center text-[0.78rem] text-[var(--ar-text-faint)]">
        {categoryName} · this is not an emergency service. If you need help now, call 911.
      </p>
    </div>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.72rem] uppercase tracking-[0.06em] text-[var(--ar-text-faint)]">
        {term}
      </dt>
      <dd className="text-[0.88rem] text-[var(--ar-body-color)]">{value || '—'}</dd>
    </div>
  );
}
