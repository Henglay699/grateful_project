import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
} from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> & {
  /** Most decimals that can be typed; 0 = whole numbers only. Unset = any. */
  decimals?: number;
  allowNegative?: boolean;
};

/** Keep only a number's characters: digits, one point (if decimals allow), a leading minus. */
export function cleanNumber(text: string, decimals?: number, allowNegative = false): string {
  const neg = allowNegative && text.trimStart().startsWith('-');
  let digits = text.replace(decimals === 0 ? /[^\d]/g : /[^\d.]/g, '');
  const dot = digits.indexOf('.');
  if (dot >= 0) {
    const frac = digits.slice(dot + 1).replace(/\./g, '');
    digits = `${digits.slice(0, dot)}.${decimals === undefined ? frac : frac.slice(0, decimals)}`;
  }
  return (neg ? '-' : '') + digits;
}

/** "1234567.5" → "1,234,567.5" (the decimals are left exactly as typed). */
export function groupNumber(raw: string): string {
  const m = /^(-?)(\d*)(\.\d*)?$/.exec(raw);
  if (!m) return raw;
  return m[1]! + m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] ?? '');
}

/** How many number characters (digits, point, minus) come before a position in the text. */
const countBefore = (text: string, pos: number) =>
  text.slice(0, pos).replace(/[^\d.-]/g, '').length;
/** The position in `text` after `n` number characters. */
function positionAfter(text: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) if (/[\d.-]/.test(text[i]!) && ++seen === n) return i + 1;
  return text.length;
}

/**
 * A text box for amounts, quantities and rates: only a number can be typed or pasted, and it
 * is shown with thousands separators (1,234,567.50). The value handed to the form or the
 * state is the plain number ("1234567.50"), so calculations and the API never see commas.
 * Works both with react-hook-form `register(...)` and as a controlled `value` / `onChange`.
 */
export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  { decimals, allowNegative = false, value, onChange, onBlur, ...rest },
  ref,
) {
  const el = useRef<HTMLInputElement | null>(null);
  const setRef = useCallback(
    (node: HTMLInputElement | null) => {
      el.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Uncontrolled (react-hook-form sets the DOM value itself): show the commas whenever the
  // field isn't being typed in, e.g. after the form is filled or reset.
  useLayoutEffect(() => {
    const node = el.current;
    if (value !== undefined || !node || document.activeElement === node) return;
    const shown = groupNumber(cleanNumber(node.value, decimals, allowNegative));
    if (shown !== node.value) node.value = shown;
  });

  /** Let the handler read the plain number, then put the grouped text (and caret) back. */
  function withPlainValue<E extends ChangeEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>>(
    e: E,
    handler: ((e: E) => void) | undefined,
  ) {
    const node = e.target;
    const caret = node.selectionStart ?? node.value.length;
    const kept = countBefore(node.value, caret);
    const raw = cleanNumber(node.value, decimals, allowNegative);
    const shown = groupNumber(raw);
    node.value = raw;
    handler?.(e);
    node.value = shown;
    if (document.activeElement === node) {
      const pos = positionAfter(shown, Math.min(kept, raw.length));
      node.setSelectionRange(pos, pos);
    }
  }

  return (
    <input
      {...rest}
      ref={setRef}
      type="text"
      inputMode={decimals === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      {...(value !== undefined && {
        value: groupNumber(cleanNumber(String(value ?? ''), decimals, allowNegative)),
      })}
      onChange={(e) => withPlainValue(e, onChange)}
      onBlur={(e) => withPlainValue(e, onBlur)}
    />
  );
});
