import { printInPlace } from '../../lib/printInPlace';
import type { BreakdownModel } from './BreakdownSheet';

/* The finished sheet goes to the print page through this tab's session storage, as Capacity's. */
const KEY = 'gs:co-breakdown';

export function printBreakdown(m: BreakdownModel): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode: the print page says to open the breakdown first */
  }
  printInPlace('/print/co-breakdown');
}

export function readPrintedBreakdown(): BreakdownModel | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BreakdownModel) : null;
  } catch {
    return null;
  }
}
