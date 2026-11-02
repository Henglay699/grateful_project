/** Deterministic pseudo-random generator so every `pnpm db:seed` produces the same data. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;
  const float = (min: number, max: number, dp = 2) =>
    Number((next() * (max - min) + min).toFixed(dp));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!;
  const chance = (p: number) => next() < p;
  function weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((s, i) => s + weight(i), 0);
    let r = next() * total;
    for (const i of items) {
      r -= weight(i);
      if (r <= 0) return i;
    }
    return items[items.length - 1]!;
  }
  return { next, int, float, pick, chance, weighted };
}
export type Rng = ReturnType<typeof createRng>;

/** ISO 6346 container number with a valid check digit, e.g. MRKU8974303. */
export function containerNumber(rng: Rng, prefix: string): string {
  const letterValues: Record<string, number> = {};
  let v = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v++;
    letterValues[ch] = v++;
  }
  const serial = String(rng.int(0, 999999)).padStart(6, '0');
  const body = prefix + serial;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = body[i]!;
    const val = /[A-Z]/.test(c) ? letterValues[c]! : Number(c);
    sum += val * 2 ** i;
  }
  return body + String((sum % 11) % 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
