import { maskDateISO, maskDateUS, maskDigits, maskPhone, maskZip } from './masks';

describe('input masks', () => {
  describe('phone', () => {
    it('formats progressively as digits arrive', () => {
      expect(maskPhone('555').display).toBe('(555');
      expect(maskPhone('555123').display).toBe('(555) 123');
      // The hyphen appears as soon as a seventh digit arrives, not at the end.
      expect(maskPhone('5551234').display).toBe('(555) 123-4');
      expect(maskPhone('5551234567').display).toBe('(555) 123-4567');
    });

    it('submits bare digits, not what is displayed', () => {
      // The API wants ten digits; the person wants punctuation. Keeping them
      // separate is the whole point of the mask.
      expect(maskPhone('(555) 123-4567').raw).toBe('5551234567');
    });

    it('ignores letters and stops at ten digits', () => {
      expect(maskPhone('555abc123def45671234').raw).toBe('5551234567');
    });

    it('handles deletion back to empty', () => {
      expect(maskPhone('')).toEqual({ display: '', raw: '' });
    });
  });

  describe('US date', () => {
    it('inserts dashes as you type', () => {
      expect(maskDateUS('12').display).toBe('12');
      expect(maskDateUS('1225').display).toBe('12-25');
      expect(maskDateUS('12251990').display).toBe('12-25-1990');
    });

    it('re-masks an already formatted value without doubling separators', () => {
      expect(maskDateUS('12-25-1990').display).toBe('12-25-1990');
    });

    it('accepts a date pasted with slashes', () => {
      // Clients send MM/DD/YYYY and somebody will paste one in.
      expect(maskDateUS('12/25/1990').display).toBe('12-25-1990');
    });

    it('will not exceed eight digits', () => {
      expect(maskDateUS('122519901234').display).toBe('12-25-1990');
    });
  });

  describe('ISO date', () => {
    it('formats as YYYY-MM-DD', () => {
      expect(maskDateISO('20281231').display).toBe('2028-12-31');
      expect(maskDateISO('2028-12-31').display).toBe('2028-12-31');
    });
  });

  describe('zip', () => {
    it('handles both five and nine digit forms', () => {
      expect(maskZip('94112').display).toBe('94112');
      expect(maskZip('941121234').display).toBe('94112-1234');
    });
  });

  describe('fixed-length digits', () => {
    it('truncates to the given length', () => {
      expect(maskDigits(10)('12345678901234').raw).toBe('1234567890');
    });
  });
});
