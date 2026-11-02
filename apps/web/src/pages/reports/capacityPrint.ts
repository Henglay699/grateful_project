import { printInPlace } from '../../lib/printInPlace';
import type { CapacityModel } from './capacity';

/*
 * The print page can't read the payroll (it is only in the page's memory), so the finished
 * report — category totals, not anyone's own salary — goes through this tab's session storage.
 */
const KEY = 'gs:capacity-report';

export function printCapacity(m: CapacityModel): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode: the print page says to open the report first */
  }
  printInPlace('/print/capacity-report');
}

export function readPrintedCapacity(): CapacityModel | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CapacityModel) : null;
  } catch {
    return null;
  }
}
