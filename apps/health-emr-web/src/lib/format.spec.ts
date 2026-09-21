import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDob,
  formatPhone,
  fromDateInputValue,
  toDateInputValue,
} from './format';

describe('formatDateTime', () => {
  it('writes midnight as 00, not 24', () => {
    // `hour12: false` on en-US resolves to the h24 cycle, which renders this
    // instant as "24:43" — an hour that does not exist. Pinned because the
    // difference only shows up in the first hour of the day.
    expect(formatDateTime('2026-09-19T00:43:00.000Z')).toBe('09-19-2026 00:43 UTC');
  });

  it('formats in UTC whatever zone the host is in', () => {
    expect(formatDateTime('2026-03-01T23:40:00.000Z')).toBe('03-01-2026 23:40 UTC');
  });

  it('says so rather than printing "Invalid Date"', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('formatPhone', () => {
  it('groups a ten-digit number', () => {
    expect(formatPhone('5125558132')).toBe('(512) 555-8132');
  });

  it('drops a leading country code', () => {
    expect(formatPhone('+1 512 555 8132')).toBe('(512) 555-8132');
  });

  it('leaves anything that is not ten digits alone', () => {
    // Forcing this into the US pattern would produce a number that looks
    // dialable and is not.
    expect(formatPhone('+44 1632 960123')).toBe('+44 1632 960123');
    expect(formatPhone(null)).toBe('—');
  });
});

describe('formatDob', () => {
  it('renders MM-DD-YYYY, the format the intake form asks for', () => {
    expect(formatDob('1990-04-18')).toBe('04-18-1990');
  });

  it('does not shift the date through a time zone', () => {
    // Parsed as calendar parts. Run through `Date`, this lands on the 17th for
    // anybody west of UTC — a birthday that changes depending on who looks.
    expect(formatDob('1990-01-01T00:00:00.000Z')).toBe('01-01-1990');
  });

  it('normalises slashes to dashes', () => {
    expect(formatDob('04/18/1990')).toBe('04-18-1990');
  });
});

describe('one date format, everywhere', () => {
  it('writes MM-DD-YYYY with a zero-padded month and day', () => {
    expect(formatDateShort('2026-09-19T12:00:00.000Z')).toBe('09-19-2026');
    expect(formatDateShort('2026-01-05T12:00:00.000Z')).toBe('01-05-2026');
  });

  it('agrees with the long form, which only adds the zone', () => {
    expect(formatDate('2026-09-19T12:00:00.000Z')).toBe('09-19-2026 UTC');
  });

  it('never renders an American short month, whatever the host locale', () => {
    // The whole point of the change. A month name is ambiguous across the
    // reader's languages; 09-19-2026 is not.
    expect(formatDateShort('2026-09-19T12:00:00.000Z')).not.toMatch(/[A-Za-z]/);
  });

  it('says so rather than printing "Invalid Date"', () => {
    expect(formatDateShort(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('date inputs', () => {
  it('hands an <input type="date"> the YYYY-MM-DD it requires', () => {
    expect(toDateInputValue('2026-09-19T12:00:00.000Z')).toBe('2026-09-19');
    expect(toDateInputValue(null)).toBe('');
  });

  it('round-trips back to what the reader sees', () => {
    const iso = '2026-09-19T12:00:00.000Z';
    expect(fromDateInputValue(toDateInputValue(iso))).toBe(formatDateShort(iso));
  });

  it('leaves anything that is not a date input value alone', () => {
    expect(fromDateInputValue('')).toBe('');
    expect(fromDateInputValue('not a date')).toBe('not a date');
  });
});
