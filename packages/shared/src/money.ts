/**
 * Decimal-safe money helpers. PostgreSQL NUMERIC values arrive as strings; all
 * arithmetic is done in integer minor units (cents) so that 0.1 + 0.2 issues never
 * reach a stored total. Rounding is half-up (away from zero), as on paper invoices.
 */
export type Decimalish = number | string | null | undefined;

export function toNumber(v: Decimalish): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Shift the decimal point by `places` using the string form of the number, so
 * values like 1.005 (stored in binary as 1.00499999…) round the way a person expects.
 */
function shiftRound(n: number, places: number): number {
  const abs = Math.abs(n);
  const s = String(abs);
  const shifted = s.includes('e') ? abs * 10 ** places : Number(`${s}e${places}`);
  return Math.sign(n) * Math.round(shifted);
}

/** Convert to integer cents, rounding half away from zero. */
export function toCents(v: Decimalish): number {
  return shiftRound(toNumber(v), 2) || 0;
}

export function fromCents(c: number): number {
  return c / 100;
}

/** Round to 2 decimals (half-up). */
export function round2(v: Decimalish): number {
  return fromCents(toCents(v));
}

/** Format as a fixed 2-decimal string suitable for a NUMERIC(14,2) column. */
export function toMoneyString(v: Decimalish): string {
  const c = toCents(v);
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Sum money values exactly. */
export function sumMoney(values: Decimalish[]): number {
  return fromCents(values.reduce<number>((acc, v) => acc + toCents(v), 0));
}

/** qty × unit price, rounded to cents. Unit prices may carry 4 decimals. */
/** Parse a decimal into a scaled BigInt (value × 10^scale), rounding half away from zero. */
function toScaled(v: Decimalish, scale: number): bigint {
  return BigInt(shiftRound(toNumber(v), scale));
}

/**
 * qty × unit price, rounded to cents. Done in BigInt fixed point (qty to 3 dp,
 * price to 4 dp) so the product is exact before the single rounding step.
 */
export function lineAmount(qty: Decimalish, unitPrice: Decimalish): number {
  const product = toScaled(qty, 3) * toScaled(unitPrice, 4); // scale 10^7
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const divisor = 100000n; // 10^7 → 10^2
  let cents = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) cents += 1n;
  return fromCents(Number(neg ? -cents : cents));
}

/** USD → KHR, rounded to whole riel. */
export function usdToKhr(usd: Decimalish, rate: Decimalish): number {
  return shiftRound(toNumber(usd) * toNumber(rate), 0) || 0;
}
