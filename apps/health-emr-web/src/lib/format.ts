/**
 * Deterministic formatting for anything rendered on both sides.
 *
 * `toLocaleDateString()` and `toLocaleString()` resolve against the *host's*
 * locale and time zone. In a server-rendered page that means Node formats the
 * string one way, the browser re-renders it another, and React discards the
 * server HTML with a hydration error — while everyone, everywhere, silently sees
 * whatever locale the server container happens to have.
 *
 * Fixing the locale and the zone makes the output the same in both places and
 * the same for every reader. UTC in particular is a deliberate choice for an
 * EMR: a prescription signed at 23:40 in one zone and 02:40 the next day in
 * another is the same event, and the record should not appear to disagree with
 * itself depending on who opens it.
 */
const LOCALE = 'en-US';
const ZONE = 'UTC';

/**
 * `MM-DD-YYYY`, everywhere, with no exceptions.
 *
 * One format across the whole console — tables, detail pages, exports, and the
 * date inputs people type into. A reader who has learned that the first pair of
 * digits is the month never has to check again, and a date copied out of a
 * table pastes straight back into a field.
 *
 * `formatToParts` rather than a pattern string: it keeps the fixed locale and
 * time zone doing the calendar arithmetic, and only the assembly is ours.
 */
const dateParts = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function ymd(value: Date): { month: string; day: string; year: string } {
  const parts = dateParts.formatToParts(value);
  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { month: find('month'), day: find('day'), year: find('year') };
}

/** The one place the separator and the order are decided. */
function toMdy(value: Date): string {
  const { month, day, year } = ymd(value);
  return `${month}-${day}-${year}`;
}

const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  // `hourCycle: 'h23'`, not `hour12: false`. With en-US the latter resolves to
  // the h24 cycle, which renders midnight as "24:43" — an hour that does not
  // exist, on a record whose whole job is to say when something happened.
  hourCycle: 'h23',
});

const numberFormat = new Intl.NumberFormat(LOCALE);
const moneyFormat = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return `${toMdy(new Date(value))} UTC`;
}

/** Date only, without the zone suffix — for dense table cells. */
export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return toMdy(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return `${toMdy(date)} ${timeFormat.format(date)} UTC`;
}

/**
 * `MM-DD-YYYY` for a `<input type="date">`, which speaks only `YYYY-MM-DD`.
 *
 * The two conversions live next to each other deliberately: they are inverses,
 * and a bug in one is only ever visible against the other.
 */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const { month, day, year } = ymd(new Date(value));
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` from an input, back to the `MM-DD-YYYY` people read. */
export function fromDateInputValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[2]}-${match[3]}-${match[1]}` : value;
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Money is stored and passed as integer cents, never as a float. */
export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return moneyFormat.format(cents / 100);
}

/**
 * A US phone number, grouped so it can be read aloud.
 *
 * Anything that is not ten digits is returned untouched rather than forced into
 * the pattern — an international number mangled into `(441) 632-9600` looks
 * dialable and is not.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/**
 * A date of birth as `MM-DD-YYYY`, the format the intake form asks for.
 *
 * Parsed as plain calendar parts rather than through `Date`, because a birth
 * date has no time zone and running it through one moves it a day for anybody
 * west of UTC.
 */
export function formatDob(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[2]}-${match[3]}-${match[1]}`;
  return value.replace(/\//g, '-');
}
