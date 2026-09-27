/**
 * Input masks.
 *
 * Each returns what the person sees and what gets submitted as two separate
 * values, because they are not the same thing: somebody typing wants
 * "(555) 123-4567" and "03-14-2030", while the API wants ten digits and an ISO
 * date. Conflating them is how a form posts punctuation to a validator that
 * only accepts digits, or an American date to a column that reads it as the
 * fourteenth month.
 *
 * Ported from the product rather than imported: this site is deployed on its
 * own and must not take a build dependency on the console.
 */

export interface MaskResult {
  /** What the field shows. */
  display: string;
  /** What is sent. */
  raw: string;
}

/** US phone: displays (555) 123-4567, reports "5551234567". */
export function maskPhone(input: string): MaskResult {
  const digits = input.replace(/\D/g, '').slice(0, 10);

  if (!digits) return { display: '', raw: '' };
  if (digits.length <= 3) return { display: `(${digits}`, raw: digits };
  if (digits.length <= 6) {
    return { display: `(${digits.slice(0, 3)}) ${digits.slice(3)}`, raw: digits };
  }
  return {
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
    raw: digits,
  };
}

/**
 * A date, typed the way it is read here: MM-DD-YYYY.
 *
 * Dashes rather than slashes, because on a phone keypad a slash is a second
 * keyboard. The reported value is ISO (YYYY-MM-DD), which is what every date
 * field on the platform stores — so the reader sees their own convention and
 * the API receives the unambiguous one.
 *
 * Only a complete, real date reports a value. A half-typed "03-1" has no ISO
 * form, and inventing one would submit a date nobody chose.
 */
export function maskDateUS(input: string): MaskResult {
  const digits = input.replace(/\D/g, '').slice(0, 8);

  if (!digits) return { display: '', raw: '' };
  if (digits.length <= 2) return { display: digits, raw: '' };
  if (digits.length <= 4) {
    return { display: `${digits.slice(0, 2)}-${digits.slice(2)}`, raw: '' };
  }

  const month = digits.slice(0, 2);
  const day = digits.slice(2, 4);
  const year = digits.slice(4);
  const display = `${month}-${day}-${year}`;

  return { display, raw: digits.length === 8 ? `${year}-${month}-${day}` : '' };
}

/** Turns an ISO date back into what the field should show. */
export function isoToDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[2]}-${match[3]}-${match[1]}` : '';
}

/**
 * Whether an ISO date is one a calendar actually has.
 *
 * `13-45-2030` masks cleanly and is nonsense. Round-tripping through Date
 * catches both an impossible month and a day the month does not reach — 31
 * February becomes 3 March, which no longer matches what was typed.
 */
export function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

export const MASKS = { phone: maskPhone, date: maskDateUS } as const;
export type MaskName = keyof typeof MASKS;
