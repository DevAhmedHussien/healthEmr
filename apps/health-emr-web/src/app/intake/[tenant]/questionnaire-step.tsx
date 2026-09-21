'use client';

import type { Question, Questionnaire } from '@health-emr/types';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { SimpleSelect } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';

export interface Answers {
  [questionId: string]: string;
}

/**
 * The questions this template asks, given what has been answered so far.
 *
 * A follow-up only appears once the answer that makes it relevant is given,
 * which is the difference between an intake that asks twelve questions and one
 * that asks forty, most of which do not apply. The list shrinks and grows as
 * somebody types, so the caller must anchor its position by question id rather
 * than by index.
 */
export function visibleQuestions(questionnaire: Questionnaire, answers: Answers): Question[] {
  return questionnaire.questions.filter(
    (question) =>
      !question.showWhen || answers[question.showWhen.questionId] === question.showWhen.equals,
  );
}

/**
 * The answer that should stop the visit, if one has been given.
 *
 * A patient reporting a contraindication is not a visit for a clinician to deny
 * days later — it is one that should never be created, and they deserve to be
 * told now, in plain words, with somewhere else to go.
 */
export function disqualification(questionnaire: Questionnaire, answers: Answers): string | null {
  for (const question of visibleQuestions(questionnaire, answers)) {
    const answer = answers[question.id];
    if (!answer || !question.disqualifyIf?.length) continue;

    const given = answer.split(', ');
    if (question.disqualifyIf.some((value) => given.includes(value))) {
      return question.disqualifyMessage ?? 'We cannot continue with this answer.';
    }
  }
  return null;
}

/**
 * Records an answer, and forgets anything that depended on the old one.
 *
 * A question answered and then hidden must not travel with the submission: it
 * would read to a clinician as something the patient said, when in fact it is
 * something they said and then made irrelevant.
 */
export function answerQuestion(
  questionnaire: Questionnaire,
  answers: Answers,
  question: Question,
  value: string,
): Answers {
  const next = { ...answers, [question.id]: value };

  for (const candidate of questionnaire.questions) {
    if (candidate.showWhen?.questionId === question.id && candidate.showWhen.equals !== value) {
      delete next[candidate.id];
    }
  }
  return next;
}

/**
 * One question, on its own.
 *
 * The intake shows a single question per screen — the pattern the clinical
 * forms this replaces use, and the reason they get finished. A page of twenty
 * fields is abandoned; twenty pages of one field are not, because each one
 * looks like almost no work.
 */
export function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}) {
  const set = onChange;

  if (question.kind === 'consent') {
    // A consent is read, not answered. The text gets the room it needs rather
    // than being squeezed into a hint nobody reads — which is the difference
    // between informed consent and a tickbox.
    return (
      <div className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-white p-4">
        <p className="font-medium text-[var(--ar-headings)]">{question.prompt}</p>
        {question.body ? (
          <div className="mt-2 max-h-72 overflow-y-auto pr-1">
            {question.body
              .split('\n')
              .filter(Boolean)
              .map((paragraph, index) => (
                <p
                  key={index}
                  className="mb-2 text-[0.84rem] leading-relaxed text-[var(--ar-text-muted)]"
                >
                  {paragraph}
                </p>
              ))}
          </div>
        ) : null}
        <div className="mt-3">
          <SimpleSelect
            value={value}
            onValueChange={set}
            placeholder="Choose one"
            options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
          />
        </div>
      </div>
    );
  }

  return (
    <Field label={question.prompt} hint={question.help}>
      {question.kind === 'longText' ? (
        <Textarea rows={4} value={value} onChange={(event) => set(event.target.value)} autoFocus />
      ) : question.kind === 'yesNo' ? (
        <SimpleSelect
          value={value}
          onValueChange={set}
          placeholder="Choose one"
          options={[
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
          ]}
        />
      ) : question.kind === 'single' ? (
        <SimpleSelect
          value={value}
          onValueChange={set}
          placeholder="Choose one"
          options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
        />
      ) : question.kind === 'multiple' ? (
        <MultiSelect
          value={value}
          onValueChange={(next) => set(next.split(',').filter(Boolean).join(', '))}
          placeholder="Choose any that apply"
          options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
        />
      ) : question.kind === 'height' ? (
        <Input
          value={value}
          placeholder={'e.g. 5\'6"'}
          onChange={(event) => set(event.target.value)}
          autoFocus
        />
      ) : question.kind === 'weight' ? (
        <Input
          inputMode="numeric"
          value={value}
          placeholder={`e.g. 180 ${question.unit ?? 'lb'}`}
          onChange={(event) => set(event.target.value)}
          autoFocus
        />
      ) : (
        <Input
          type={question.kind === 'number' ? 'number' : question.kind === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(event) => set(event.target.value)}
          autoFocus
        />
      )}
    </Field>
  );
}

/**
 * Turns answers into the `Q1`/`A1` pairs the platform expects.
 *
 * Only questions that were actually shown are sent: a hidden one has no answer,
 * and inventing an empty one would read to a clinician as "asked, and left
 * blank" rather than "not applicable".
 */
export function toQaPairs(questionnaire: Questionnaire, answers: Answers): Record<string, string> {
  const pairs: Record<string, string> = {};
  let index = 1;

  for (const question of questionnaire.questions) {
    if (question.showWhen && answers[question.showWhen.questionId] !== question.showWhen.equals)
      continue;
    const answer = answers[question.id];
    if (answer === undefined || answer === '') continue;

    pairs[`Q${index}`] = question.prompt;
    pairs[`A${index}`] = answer;
    index += 1;
  }

  return pairs;
}

/** Which shown, required questions are still unanswered. */
export function missingAnswers(questionnaire: Questionnaire, answers: Answers): string[] {
  return questionnaire.questions
    .filter(
      (question) =>
        !question.showWhen || answers[question.showWhen.questionId] === question.showWhen.equals,
    )
    .filter((question) => question.required && !answers[question.id])
    .map((question) => question.prompt);
}
