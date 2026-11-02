import { toCents, type Decimalish } from './money';

const ONES = [
  '',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
  'TEN',
  'ELEVEN',
  'TWELVE',
  'THIRTEEN',
  'FOURTEEN',
  'FIFTEEN',
  'SIXTEEN',
  'SEVENTEEN',
  'EIGHTEEN',
  'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION'];

function belowThousand(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(`${ONES[hundreds]} HUNDRED`);
  if (rest >= 20)
    words.push(TENS[Math.floor(rest / 10)]! + (rest % 10 ? ` ${ONES[rest % 10]}` : ''));
  else if (rest) words.push(ONES[rest]!);
  return words.join(' ');
}

/** 12790 → "TWELVE THOUSAND SEVEN HUNDRED NINETY" (whole numbers up to the billions). */
export function integerInWords(n: number): string {
  if (n === 0) return 'ZERO';
  const groups: string[] = [];
  for (let i = 0, rest = Math.floor(Math.abs(n)); rest > 0; i++, rest = Math.floor(rest / 1000)) {
    const g = rest % 1000;
    if (g) groups.unshift(SCALES[i] ? `${belowThousand(g)} ${SCALES[i]}` : belowThousand(g));
  }
  return groups.join(' ');
}

/**
 * A USD amount as written on the official receipt, in the style of the Excel receipts:
 * 8978.51 → "EIGHT THOUSAND NINE HUNDRED SEVENTY EIGHT DOLLARS AND FIFTY ONE CENTS."
 * Whole amounts end in "ONLY.". Always derived from the amount, so the two cannot disagree.
 */
export function amountInWords(amount: Decimalish): string {
  const cents = toCents(amount);
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const c = abs % 100;
  const d = `${integerInWords(dollars)} ${dollars === 1 ? 'DOLLAR' : 'DOLLARS'}`;
  const text = c ? `${d} AND ${integerInWords(c)} ${c === 1 ? 'CENT' : 'CENTS'}` : `${d} ONLY`;
  return `${cents < 0 ? 'MINUS ' : ''}${text}.`;
}
