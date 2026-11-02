import type { CustomsReportData } from '@gs/shared';
import { khmerDigits, KH_MONTHS } from './capacity';

/*
 * Reports → Import & Export: the factory's report of goods in (or out) by customs declaration,
 * laid out like its "IMP & EXP--REPORT" workbook. Shared by the screen, the print page and Excel.
 */

export interface CustomsSigner {
  /** "2026-09-30": the day written above the signature. */
  date: string;
  title: string;
  name: string;
}

export interface CustomsRow {
  no: number;
  declareNo: string;
  declareDate: string;
  goods: string;
  /** The sheet's "Unit" column: customs value ÷ quantity. */
  unitValue: number;
  qty: number;
  netWeightKg: number;
  grossWeightKg: number;
  value: number;
}

export interface CustomsModel {
  direction: 'IMPORT' | 'EXPORT';
  from: string;
  to: string;
  titleKh: string;
  subtitleKh: string;
  qtyHeadKh: string;
  rows: CustomsRow[];
  totals: { qty: number; netWeightKg: number; grossWeightKg: number; value: number };
  totalLabel: string;
  signDateKh: string;
  signer: CustomsSigner;
  fileName: string;
  sheetName: string;
}

export const DEFAULT_SIGNER_TITLE = 'ប្រធានក្រុមហ៊ុន';

const monthName = (month: string) => KH_MONTHS[Number(month.slice(5, 7)) - 1] ?? '';

/** "2026-01".."2026-09" → "ខែ មករា ឆ្នាំ 2026 រហូតដល់ ខែ កញ្ញា ឆ្នាំ 2026" (years as on the sheet). */
export function khmerPeriod(from: string, to: string): string {
  const one = (m: string) => `ខែ ${monthName(m)} ឆ្នាំ ${m.slice(0, 4)}`;
  return from === to ? one(to) : `${one(from)} រហូតដល់ ${one(to)}`;
}

/** "2026-09-30" → "ថ្ងៃទី ៣០ ខែ កញ្ញា ឆ្នាំ ២០២៦". */
export function khmerDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return `ថ្ងៃទី ${khmerDigits(Number(iso.slice(8, 10)))} ខែ ${monthName(iso)} ឆ្នាំ ${khmerDigits(iso.slice(0, 4))}`;
}

/** Last day of "2026-09" → "2026-09-30". */
export function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/**
 * The goods as the sheet names them: exports drop the fibre content
 * ("LADIES PANT KNITTED 95% POLYESTER 5% SPANDEX" → "LADIES PANT KNITTED").
 */
export function goodsName(description: string, direction: 'IMPORT' | 'EXPORT'): string {
  const d = description.replace(/\s+/g, ' ').trim().toUpperCase();
  if (direction === 'IMPORT') return d;
  const cut = d.search(/\s\d+(\.\d+)?\s*%/);
  return (cut > 0 ? d.slice(0, cut) : d).trim();
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

export function buildCustomsModel(data: CustomsReportData, signer: CustomsSigner): CustomsModel {
  const imp = data.direction === 'IMPORT';
  const rows = data.lines.map((l, i): CustomsRow => ({
    no: i + 1,
    declareNo: l.declareNo,
    declareDate: l.declareDate,
    goods: goodsName(l.description, data.direction),
    unitValue: l.qty ? l.value / l.qty : 0,
    qty: l.qty,
    netWeightKg: l.netWeightKg,
    grossWeightKg: l.grossWeightKg,
    value: l.value,
  }));
  const sum = (k: 'qty' | 'netWeightKg' | 'grossWeightKg' | 'value') =>
    round(
      rows.reduce((t, r) => t + r[k], 0),
      3,
    );
  const [y1, y2] = [data.from.slice(0, 4), data.to.slice(0, 4)];
  const m = (v: string) => Number(v.slice(5, 7));
  const company = data.companyName.trim();
  const tag = imp ? 'IMP' : 'EXP';
  return {
    direction: data.direction,
    from: data.from,
    to: data.to,
    titleKh: imp
      ? 'តារាងរបាយការណ៏នាំចូលវត្ថុធាតុដើមតាមប្រតិវេទន៏គយ'
      : 'តារាងរបាយការណ៏នាំចេញតាមប្រតិវេទន៏គយ',
    subtitleKh: `ក្រុមហ៊ុន ${company} មាន អ.ត.ប លេខ ${data.vattin || '…………'} សំរាប់ ${khmerPeriod(data.from, data.to)}`,
    qtyHeadKh: imp ? 'បរិមាណ' : 'បរិមាណ PCS',
    rows,
    totals: {
      qty: sum('qty'),
      netWeightKg: sum('netWeightKg'),
      grossWeightKg: sum('grossWeightKg'),
      value: round(
        rows.reduce((t, r) => t + r.value, 0),
        2,
      ),
    },
    totalLabel: `TOTAL ${y1 === y2 ? y2 : `${y1}–${y2}`} :`,
    signDateKh: khmerDate(signer.date),
    signer,
    fileName: `${company.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Factory'}_${tag}_Report_${data.from === data.to ? data.to : `${data.from}_to_${data.to}`}`,
    sheetName: `${tag}-${m(data.from)}-${m(data.to)}${y1 === y2 ? '' : ` ${y1}-${y2}`}`,
  };
}
