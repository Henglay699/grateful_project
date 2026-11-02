import { printInPlace } from '../../lib/printInPlace';
import type { CustomsModel } from './importExport';

/* The finished report goes to the print page through this tab's session storage, as Capacity's. */
const KEY = 'gs:customs-report';

export function printCustoms(m: CustomsModel): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode: the print page says to open the report first */
  }
  printInPlace('/print/customs-report');
}

export function readPrintedCustoms(): CustomsModel | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CustomsModel) : null;
  } catch {
    return null;
  }
}
