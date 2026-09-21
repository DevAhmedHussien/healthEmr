'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { MASKS, type MaskName } from '@/components/form/masks';

/**
 * A masked input for plain controlled forms.
 *
 * The form kit's `MaskedField` does this for react-hook-form; this is the same
 * behaviour for dialogs that hold their own state, using the same mask
 * functions so a phone number typed in a dialog and one typed in a wizard end
 * up in the same shape.
 *
 * The field shows the formatted value and reports the raw one, so what a person
 * reads and what the API receives can differ without either side knowing.
 */
export function MaskedInput({
  mask,
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  mask: MaskName;
  /** The raw value — digits for a phone, ISO for a date. */
  value: string;
  onValueChange: (raw: string) => void;
}) {
  const apply = MASKS[mask];
  const [display, setDisplay] = React.useState(() => apply(value ?? '').display);

  // Re-derive when the value changes from outside, e.g. a form being reset.
  React.useEffect(() => {
    setDisplay((current) => {
      const next = apply(value ?? '');
      return next.raw === apply(current).raw ? current : next.display;
    });
  }, [value, apply]);

  return (
    <input
      {...props}
      value={display}
      inputMode={mask === 'phone' ? 'tel' : 'numeric'}
      onChange={(event) => {
        const next = apply(event.target.value);
        setDisplay(next.display);
        onValueChange(next.raw);
      }}
      className={cn('ar-input', className)}
    />
  );
}
