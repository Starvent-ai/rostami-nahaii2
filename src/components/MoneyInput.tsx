import { useEffect, useState, type KeyboardEvent } from 'react';

function digitsOnly(s: string): string {
  return s.replace(/[^\d-]/g, '');
}

function formatGrouped(digits: string): string {
  if (!digits) return '';
  const neg = digits.startsWith('-');
  const clean = digits.replace('-', '');
  if (!clean) return neg ? '-' : '';
  return (neg ? '-' : '') + Number(clean).toLocaleString('en-US');
}

/**
 * A money amount input that shows thousands separators as the operator
 * types (e.g. "1,500,000") — plain `<input type="number">` can't do this
 * (no comma support at all), and large amounts typed without grouping are a
 * common source of operator entry mistakes (an extra or missing zero).
 * `value`/`onChange` work with the plain numeric value; formatting is purely
 * a display concern handled internally.
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  allowNegative,
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired on blur with the current plain numeric string — for the
   * onBlur-to-save pattern used across Settings/tab-detail editable fields. */
  onBlur?: (value: string) => void;
  placeholder?: string;
  className?: string;
  allowNegative?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [display, setDisplay] = useState(() => formatGrouped(value));
  const [digitsState, setDigitsState] = useState(() => digitsOnly(value));

  useEffect(() => {
    setDisplay(formatGrouped(value));
    setDigitsState(digitsOnly(value));
  }, [value]);

  function handleChange(raw: string) {
    let digits = digitsOnly(raw);
    if (!allowNegative) digits = digits.replace('-', '');
    setDisplay(formatGrouped(digits));
    setDigitsState(digits);
    onChange(digits.replace('-', '') === '' ? '' : digits);
  }

  return (
    <input
      className={className ?? 'checkout-input'}
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={display}
      autoFocus={autoFocus}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => onBlur?.(digitsState)}
      onKeyDown={onKeyDown}
    />
  );
}
