/**
 * Khmer calendar dates for customs letters, e.g.
 *   lunar: "ថ្ងៃអង្គារ ៤កើត ខែភទ្របទ ឆ្នាំមមី អដ្ឋស័ក ពុទ្ធសករាជ ២៥៧០"
 *   solar: "រាជធានីភ្នំពេញ ថ្ងៃទី១៥ ខែកញ្ញា ឆ្នាំ២០២៦"
 *
 * The lunar calendar follows the Chhankitek rules (as in the momentkh library): a lunar year
 * of 354 days, 355 with a leap day in Jesth, or 384 with a second Asadh month, counted from
 * 1 kert of Boss on 1 January 1900.
 */

const DIGITS = '០១២៣៤៥៦៧៨៩';
export const khmerNumber = (n: number | string) =>
  String(n).replace(/\d/g, (d) => DIGITS[Number(d)]!);

export const KH_WEEKDAYS = ['អាទិត្យ', 'ចន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
export const KH_SOLAR_MONTHS = [
  'មករា',
  'កុម្ភៈ',
  'មីនា',
  'មេសា',
  'ឧសភា',
  'មិថុនា',
  'កក្កដា',
  'សីហា',
  'កញ្ញា',
  'តុលា',
  'វិច្ឆិកា',
  'ធ្នូ',
];
/** Lunar months by index; 12 and 13 are the two Asadh months of a leap-month year. */
export const KH_LUNAR_MONTHS = [
  'មិគសិរ',
  'បុស្ស',
  'មាឃ',
  'ផល្គុន',
  'ចេត្រ',
  'ពិសាខ',
  'ជេស្ឋ',
  'អាសាឍ',
  'ស្រាពណ៍',
  'ភទ្របទ',
  'អស្សុជ',
  'កត្តិក',
  'បឋមាសាឍ',
  'ទុតិយាសាឍ',
];
const ANIMAL_YEARS = [
  'ជូត',
  'ឆ្លូវ',
  'ខាល',
  'ថោះ',
  'រោង',
  'ម្សាញ់',
  'មមី',
  'មមែ',
  'វក',
  'រកា',
  'ច',
  'កុរ',
];
const ERA_YEARS = [
  'សំរឹទ្ធិស័ក',
  'ឯកស័ក',
  'ទោស័ក',
  'ត្រីស័ក',
  'ចត្វាស័ក',
  'បញ្ចស័ក',
  'ឆស័ក',
  'សប្តស័ក',
  'អដ្ឋស័ក',
  'នព្វស័ក',
];
const BOSS = 1;
const JESTH = 6;
const ASADH = 7;
const ASADH_1 = 12;
const ASADH_2 = 13;

const aharkun = (be: number) => Math.floor((be * 292207 + 499) / 800) + 4;
const avoman = (be: number) => (11 * aharkun(be) + 25) % 692;
const bodithey = (be: number) => {
  const ahk = aharkun(be);
  return (Math.floor((11 * ahk + 25) / 692) + ahk + 29) % 30;
};
const solarLeap = (be: number) => 800 - ((be * 292207 + 499) % 800) <= 207;

/** 0 regular, 1 leap month, 2 leap day, 3 both (before the protetin shift). */
function boditheyLeap(be: number): number {
  const b = bodithey(be);
  let month = b >= 25 || b <= 5;
  // Of a consecutive 25/5 pair only the 5 is a leap-month year; of 24/6 the 24 is.
  if (b === 25 && bodithey(be + 1) === 5) month = false;
  if (b === 24 && bodithey(be + 1) === 6) month = true;
  const a = avoman(be);
  const day = solarLeap(be) ? a <= 126 : a <= 137 && avoman(be + 1) !== 0;
  return month && day ? 3 : month ? 1 : day ? 2 : 0;
}

/** 0 regular, 1 leap month (384 days), 2 leap day (355 days). */
function yearType(be: number): 0 | 1 | 2 {
  const b = boditheyLeap(be);
  if (b === 3) return 1;
  if (b === 1 || b === 2) return b;
  // A year that would have had both moves its leap day to the next year.
  return boditheyLeap(be - 1) === 3 ? 2 : 0;
}

/** The months of one lunar year, Boss to Migasir, with their lengths. */
function monthsOfYear(be: number): [month: number, days: number][] {
  const type = yearType(be);
  const out: [number, number][] = [];
  for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]) {
    if (m === ASADH && type === 1) {
      out.push([ASADH_1, 30], [ASADH_2, 30]);
      continue;
    }
    const days = m === JESTH && type === 2 ? 30 : m % 2 === 0 ? 29 : 30;
    out.push([m, days]);
  }
  return out;
}

const DAY_MS = 86_400_000;
const utcDays = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY_MS;
const EPOCH = utcDays(1900, 1, 1); // 1 kert of Boss

export interface KhmerLunarDate {
  /** 0–29: 0–14 are 1–15 kert (waxing), 15–29 are 1–15 roach (waning). */
  day: number;
  month: number;
}

/** Lunar day and month of a calendar date (1900 onwards). */
export function lunarDate(y: number, m: number, d: number): KhmerLunarDate {
  let left = utcDays(y, m, d) - EPOCH;
  if (left < 0) throw new RangeError('Khmer lunar dates start in 1900');
  // The lunar year that starts at Boss of Gregorian year Y holds its leap month in BE Y+544.
  for (let year = 1900; ; year++) {
    const months = monthsOfYear(year + 544);
    const total = months.reduce((s, [, n]) => s + n, 0);
    if (left >= total) {
      left -= total;
      continue;
    }
    for (const [month, days] of months) {
      if (left < days) return { day: left, month };
      left -= days;
    }
  }
}

const isoParts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

/** "២៥៧០": the Buddhist era turns over on Visak Bochea (15 kert of Pisakh). */
function buddhistYear(y: number, m: number, l: KhmerLunarDate): number {
  if (m < 4) return y + 543;
  if (l.month === BOSS - 1 || l.month === BOSS) return y + 544; // Migasir / Boss in Nov–Dec
  if (l.month >= 2 && l.month <= 4) return y + 543; // Meak–Chet still before Pisakh
  if (l.month === 5) return l.day >= 14 ? y + 544 : y + 543;
  return y + 544;
}

/**
 * Animal year and era (ស័ក) change at Khmer New Year. Taken as 14 April, the usual first day;
 * in years where it falls on the 13th that single day reads as the old year.
 */
function newYearOffset(m: number, d: number) {
  return m > 4 || (m === 4 && d >= 14) ? 1 : 0;
}

/** Lunar date parts of an ISO date, for callers that format them their own way. */
export function khmerLunarParts(iso: string) {
  const [y, m, d] = isoParts(iso);
  const l = lunarDate(y, m, d);
  const ny = newYearOffset(m, d);
  return {
    weekday: KH_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!,
    day: l.day < 15 ? `${khmerNumber(l.day + 1)}កើត` : `${khmerNumber(l.day - 14)}រោច`,
    month: KH_LUNAR_MONTHS[l.month]!,
    animal: ANIMAL_YEARS[(y + 543 + ny + 4) % 12]!,
    era: ERA_YEARS[(y + 543 + ny - 1182) % 10]!,
    be: khmerNumber(buddhistYear(y, m, l)),
  };
}

/** "ថ្ងៃអង្គារ ៤កើត ខែភទ្របទ ឆ្នាំមមី អដ្ឋស័ក ពុទ្ធសករាជ ២៥៧០" */
export function khmerLunarText(iso: string): string {
  const p = khmerLunarParts(iso);
  return `ថ្ងៃ${p.weekday} ${p.day} ខែ${p.month} ឆ្នាំ${p.animal} ${p.era} ពុទ្ធសករាជ ${p.be}`;
}

/** "រាជធានីភ្នំពេញ ថ្ងៃទី១៥ ខែកញ្ញា ឆ្នាំ២០២៦" */
export function khmerSolarText(iso: string, place = 'រាជធានីភ្នំពេញ'): string {
  const [y, m, d] = isoParts(iso);
  return `${place} ថ្ងៃទី${khmerNumber(d)} ខែ${KH_SOLAR_MONTHS[m - 1]} ឆ្នាំ${khmerNumber(y)}`;
}
