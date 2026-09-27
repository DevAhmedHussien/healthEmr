import { z } from 'zod';

/**
 * The window and the clock for an activity report.
 *
 * The time zone matters more than it looks: "hours per day" is a statement
 * about calendar days, and a clinician in Florida working until 9pm would
 * otherwise have half their evening counted against tomorrow. It is validated
 * here rather than passed through, because an unknown zone reaches Postgres as
 * an error nobody can act on.
 */
export const activityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
  timeZone: z
    .string()
    .trim()
    .max(64)
    .default('America/New_York')
    .refine(isKnownTimeZone, { message: 'Unknown time zone' }),
});

function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export type ActivityQuery = z.infer<typeof activityQuerySchema>;
