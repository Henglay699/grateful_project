import type { SealPlanRow } from '@gs/shared';
import { fmtNum } from '../../lib/format';

export const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

/** "2026-07" → "JULY 2026", the sheet's month heading. */
export const monthHeading = (ym: string) =>
  `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Rows arrive sorted by month; NO. restarts each month, as in the sheet. */
export function groupByMonth(rows: SealPlanRow[]) {
  const out: { month: string; rows: SealPlanRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last?.month === r.month) last.rows.push(r);
    else out.push({ month: r.month, rows: [r] });
  }
  return out;
}

/** "3,860 KGS", as on the sheet. */
export const fmtTare = (v: string | null) => (v ? `${fmtNum(v)} KGS` : '-');

/** The list filters a Seal Plans export or print carries over. */
export const SEAL_PLAN_FILTERS = ['year', 'month', 'clientId', 'q'] as const;
