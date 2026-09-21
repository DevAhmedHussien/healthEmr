/**
 * Input masks.
 *
 * Each returns the display string and the raw value separately, because the API
 * wants ten digits while the person typing wants to see "(555) 123-4567". Mixing
 * those up is how a form ends up posting punctuation to a validator that only
 * accepts digits.
 */

export interface MaskResult {
  /** What the user sees in the field. */
  display: string;
  /** What gets submitted. */
  raw: string;
}

/** US phone: (555) 123-4567 → raw "5551234567". */
export function maskPhone(input: string): MaskResult {
  const digits = input.replace(/\D/g, '').slice(0, 10);

  if (digits.length === 0) return { display: '', raw: '' };
  if (digits.length <= 3) return { display: `(${digits}`, raw: digits };
  if (digits.length <= 6)
    return { display: `(${digits.slice(0, 3)}) ${digits.slice(3)}`, raw: digits };

  return {
    display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
    raw: digits,
  };
}

/**
 * MM-DD-YYYY.
 *
 * Dashes rather than slashes: on a phone keypad a slash is a second keyboard,
 * and a date typed with the separator already in place is one fewer thing to
 * get wrong. The API accepts either, so what a person reads and what is sent
 * agree.
 */
export function maskDateUS(input: string): MaskResult {
  const digits = input.replace(/\D/g, '').slice(0, 8);

  if (digits.length === 0) return { display: '', raw: '' };
  if (digits.length <= 2) return { display: digits, raw: digits };
  if (digits.length <= 4)
    return { display: `${digits.slice(0, 2)}-${digits.slice(2)}`, raw: digits };

  const display = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
  return { display, raw: display };
}

/** YYYY-MM-DD, for anything that goes into a date column. */
export function maskDateISO(input: string): MaskResult {
  const digits = input.replace(/\D/g, '').slice(0, 8);

  if (digits.length === 0) return { display: '', raw: '' };
  if (digits.length <= 4) return { display: digits, raw: digits };
  if (digits.length <= 6)
    return { display: `${digits.slice(0, 4)}-${digits.slice(4)}`, raw: digits };

  const display = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  return { display, raw: display };
}

/** 12345 or 12345-6789. */
export function maskZip(input: string): MaskResult {
  const digits = input.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 5) return { display: digits, raw: digits };
  const display = `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return { display, raw: display };
}

/** Digits only, fixed length — NPI, DEA and similar. */
export function maskDigits(length: number) {
  return (input: string): MaskResult => {
    const digits = input.replace(/\D/g, '').slice(0, length);
    return { display: digits, raw: digits };
  };
}

export const MASKS = {
  phone: maskPhone,
  dateUS: maskDateUS,
  dateISO: maskDateISO,
  zip: maskZip,
  npi: maskDigits(10),
} as const;

export type MaskName = keyof typeof MASKS;
