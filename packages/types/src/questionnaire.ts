import { z } from 'zod';

/**
 * A questionnaire, per category.
 *
 * Each visit type asks different things — a weight-loss intake needs a height
 * and weight and a GLP-1 history; a hair-loss one does not. The template is
 * data rather than code so a new category, or a new question on an existing
 * one, is a row rather than a deploy.
 *
 * Answers travel to the platform as the `Q1`/`A1` pairs the partner contract
 * already carries, so a form built from a template and a client posting the
 * payload by hand produce exactly the same visit.
 */

export const questionKindSchema = z.enum([
  'text',
  'longText',
  'number',
  'single',
  'multiple',
  'yesNo',
  'date',
  'height',
  'weight',
  /**
   * A block of text the patient must read and accept. Rendered differently
   * because it is not a question in the ordinary sense — the words are the
   * point, and one of the answers ends the visit.
   */
  'consent',
]);
export type QuestionKind = z.infer<typeof questionKindSchema>;

export const questionSchema = z.object({
  /** Stable within a template. Becomes the `Q{n}` position on submission. */
  id: z.string().trim().min(1).max(60),
  prompt: z.string().trim().min(1).max(500),
  kind: questionKindSchema,
  help: z.string().trim().max(500).optional(),
  /**
   * The full text of a consent, or any long preamble the question depends on.
   * Separate from `help` because consents run to several paragraphs and must be
   * shown in full rather than as a hint.
   */
  body: z.string().max(8000).optional(),
  required: z.boolean().default(true),
  /** For `single` and `multiple`. */
  options: z.array(z.string().trim().min(1).max(160)).max(40).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().trim().max(20).optional(),
  /**
   * Show this question only when another was answered a particular way — the
   * difference between an intake that asks twelve relevant questions and one
   * that asks forty, most of which do not apply.
   */
  showWhen: z
    .object({ questionId: z.string().trim().min(1), equals: z.string().trim().min(1) })
    .optional(),
  /**
   * An answer that should stop the visit rather than route it. A patient
   * reporting a contraindication is not a visit for a clinician to deny later —
   * it is one that should never have been created.
   */
  disqualifyIf: z.array(z.string().trim().min(1)).max(20).optional(),
  disqualifyMessage: z.string().trim().max(500).optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionnaireSchema = z.object({
  /** Shown above the questions, e.g. "About your weight". */
  title: z.string().trim().min(1).max(160),
  intro: z.string().trim().max(1000).optional(),
  /** Whether this category needs a photo of the patient's ID. */
  requiresPhotoId: z.boolean().default(true),
  questions: z.array(questionSchema).min(1).max(60),
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;

/** What the API returns when a form asks what to render for a visit type. */
export interface QuestionnaireResponse {
  visitType: string;
  category: { slug: string; name: string };
  version: number;
  questionnaire: Questionnaire;
}
