import React, { useState } from 'react';

/**
 * Controlled numeric input that ALLOWS AN EMPTY / PARTIAL VALUE while editing.
 *
 * A plain `<input type="number" value={someNumber}>` with an `if (!isNaN(v)) onChange(v)` guard
 * silently rejects an empty string, so the user can never delete the last digit of a cell — the
 * old value is re-rendered on the next keystroke. This component keeps a local text buffer while
 * the field is focused, so intermediate states ("", "-", "1.", "0.0") are preserved and the cell
 * can genuinely be cleared. It emits `undefined` when the cell is empty/partial and a parsed number
 * otherwise; on blur it drops the buffer and re-renders the model value (formatted).
 *
 * Works in DISPLAY units — the caller scales (e.g. ×100 for a percent) before passing `value` and
 * un-scales inside `onValue`.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined;          // display-unit value (NaN / null / undefined → shown blank)
  onValue: (v: number | undefined) => void;  // display-unit value; undefined when the cell is cleared
  commas?: boolean;                           // thousands separators when the field is NOT being edited
};

export default function NumInput({ value, onValue, commas, onFocus, onBlur, ...rest }: Props) {
  const [buf, setBuf] = useState<string | null>(null);   // local edit buffer; null → show the model value

  const num = (value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value)))
    ? undefined : value;
  const formatted = num === undefined ? ''
    : (commas && Math.abs(num) >= 1000 ? num.toLocaleString('en-US') : String(num));
  const shown = buf !== null ? buf : formatted;

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={shown}
      onFocus={e => { setBuf(num === undefined ? '' : String(num)); onFocus?.(e); }}
      onChange={e => {
        const raw = e.target.value;
        setBuf(raw);
        const cleaned = raw.replace(/,/g, '').trim();
        if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.' || cleaned === '+') {
          onValue(undefined);   // empty or partial → cleared
          return;
        }
        const v = parseFloat(cleaned);
        if (!Number.isNaN(v)) onValue(v);
      }}
      onBlur={e => { setBuf(null); onBlur?.(e); }}
    />
  );
}
