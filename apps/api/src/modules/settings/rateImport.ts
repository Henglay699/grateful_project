import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

/** Plausible KHR per USD; anything outside is treated as "not a rate" (e.g. a year or row no.). */
const MIN_RATE = 1000;
const MAX_RATE = 10000;

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

export interface ParsedRates {
  /** effectiveDate (YYYY-MM-DD) → rate; a date repeated later in the file wins. */
  rates: Map<string, string>;
  skipped: { sheet: string; row: number; message: string }[];
}

/**
 * Read dated USD→KHR rates from any simple sheet layout, e.g. the NBC "Exchange Rate 2026"
 * file: Release Date | Currency | Rate. Every row with a date and a rate-sized number is
 * taken, so titles, headers and blank rows are skipped automatically. Dates can be real
 * Excel dates or text ("September 30, 2026", "30-Sep-26", "2026-09-30", "30/09/2026");
 * rates can be numbers or numbers stored as text. All sheets are read.
 */
export async function parseRateWorkbook(buffer: Buffer, fileName: string): Promise<ParsedRates> {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(fileName)) await wb.csv.read(Readable.from(buffer));
  else await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const rates = new Map<string, string>();
  const skipped: ParsedRates['skipped'] = [];
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible') continue;
    ws.eachRow((row, r) => {
      let date: string | null = null;
      let rate: number | null = null;
      row.eachCell((cell) => {
        const v = raw(cell);
        if (!date) {
          const d = toIsoDate(v);
          if (d) {
            date = d;
            return;
          }
        }
        const n = toNumber(v);
        if (n !== null && n >= MIN_RATE && n <= MAX_RATE) rate = n; // last rate-sized number wins
      });
      if (!date) return; // title, header or blank row
      if (rate === null) {
        skipped.push({ sheet: ws.name, row: r, message: `No rate found for ${date}` });
        return;
      }
      rates.set(date, String(rate));
    });
  }
  return { rates, skipped };
}

function raw(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as ExcelJS.CellFormulaValue).result;
  if (v && typeof v === 'object' && 'richText' in v) return cell.text;
  return v;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const monthNo = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase() as never) + 1;

/** Excel date cell or a date written as text; anything else → null. */
export function toIsoDate(v: unknown): string | null {
  // Excel stores dates without a zone; exceljs hands them over as UTC midnight.
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  // 2026-09-30
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return iso(+m[1]!, +m[2]!, +m[3]!);
  // September 30, 2026 / Sep 30 2026
  if ((m = /^([A-Za-z]{3,})\.? (\d{1,2}),? (\d{4})$/.exec(s)) && monthNo(m[1]!))
    return iso(+m[3]!, monthNo(m[1]!), +m[2]!);
  // 30 September 2026 / 30-Sep-26 / 30 Sep, 2026
  if ((m = /^(\d{1,2})[- ]([A-Za-z]{3,})\.?[-, ]+(\d{2,4})$/.exec(s)) && monthNo(m[2]!))
    return iso(+m[3]!, monthNo(m[2]!), +m[1]!);
  // 30/09/2026 (day first, as used in Cambodia)
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) return iso(+m[3]!, +m[2]!, +m[1]!);
  return null;
}
