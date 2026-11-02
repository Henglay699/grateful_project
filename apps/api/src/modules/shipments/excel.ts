import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { invoiceHtsCodes, type CargoExcelParseResult } from '@gs/shared';

/** Header aliases ported from the prototype's cargoExcelHeaderMap (matching is case/space/punctuation-insensitive). */
const HEADERS: { field: keyof Line | 'invoiceNo' | 'invoiceDate'; match: string[] }[] = [
  { field: 'invoiceNo', match: ['invoice no', 'invoiceno', 'invoice number', 'inv no'] },
  { field: 'invoiceDate', match: ['inv date', 'invoice date'] },
  { field: 'poNo', match: ['po#', 'po #', 'po no', 'po number', 'po'] },
  { field: 'styleNo', match: ['style', 'style no', 'style#'] },
  { field: 'htsCode', match: ['hts code', 'hts', 'htscode'] },
  { field: 'pcs', match: ['pcs', 'pieces', 'qty'] },
  { field: 'ctns', match: ['ctns', 'cartons', 'ctn'] },
  { field: 'cbm', match: ['cbm'] },
  { field: 'netWeightKg', match: ['n.w kgs', 'nw kgs', 'net weight', 'n.w', 'nw'] },
  { field: 'grossWeightKg', match: ['g.w kgs', 'gw kgs', 'gross weight', 'g.w', 'gw'] },
  { field: 'fobUnitPrice', match: ['fob price', 'fob', 'price'] },
  { field: 'description', match: ['description', 'desc'] },
];
type Line = CargoExcelParseResult['invoices'][number]['lines'][number];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, '');
const HEADER_LOOKUP = new Map(
  HEADERS.flatMap((h) => h.match.map((m) => [norm(m), h.field] as const)),
);

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};
const iso = (y: number, m: number, d: number) =>
  y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null;

/** Accepts Excel dates, serial numbers, 2026-09-10, 10/09/2026 (day first) and 10-SEP-26. */
export function parseDateCell(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000)
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v ?? '')
    .trim()
    .toUpperCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s);
  if (m) return iso(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[-\s]([A-Z]{3})[-\s](\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2]!])
    return iso(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, MONTHS[m[2]!]!, +m[1]!);
  return null;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'result' in v)
    return String((v as ExcelJS.CellFormulaValue).result ?? '').trim();
  return (cell.text ?? String(v)).trim();
}

function cellRaw(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as ExcelJS.CellFormulaValue).result;
  return v;
}

/**
 * Parse the Export Template layout (INVOICE NO, INV DATE, PO#, STYLE, HTS CODE, PCS, CTNS, CBM,
 * N.W KGS, G.W KGS, FOB PRICE, DESCRIPTION) into invoices with line items. Blank INVOICE NO /
 * INV DATE cells continue the invoice above, as in the template.
 */
export async function parseCargoWorkbook(
  buffer: Buffer,
  fileName: string,
): Promise<CargoExcelParseResult> {
  const wb = new ExcelJS.Workbook();
  const ws = /\.csv$/i.test(fileName)
    ? await wb.csv.read(Readable.from(buffer))
    : (await wb.xlsx.load(buffer as unknown as ArrayBuffer), wb.worksheets[0]);
  const warnings: CargoExcelParseResult['warnings'] = [];
  if (!ws)
    return {
      invoices: [],
      warnings: [{ row: null, message: 'The workbook has no sheets.' }],
      rowsRead: 0,
    };

  // Find the header row within the first 10 rows.
  let headerRow = 0;
  let columns = new Map<number, string>();
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const found = new Map<number, string>();
    ws.getRow(r).eachCell((cell, col) => {
      const f = HEADER_LOOKUP.get(norm(cellText(cell)));
      if (f && ![...found.values()].includes(f)) found.set(col, f);
    });
    if (found.size >= 3) {
      headerRow = r;
      columns = found;
      break;
    }
  }
  if (!headerRow) {
    return {
      invoices: [],
      warnings: [
        {
          row: null,
          message:
            'No header row found. Use the Export Template columns: INVOICE NO, INV DATE, PO#, STYLE, HTS CODE, PCS, CTNS, CBM, N.W KGS, G.W KGS, FOB PRICE, DESCRIPTION.',
        },
      ],
      rowsRead: 0,
    };
  }
  if (![...columns.values()].includes('invoiceNo'))
    warnings.push({
      row: headerRow,
      message: 'No INVOICE NO column: all lines were put on one invoice called "IMPORTED".',
    });

  const invoices = new Map<string, CargoExcelParseResult['invoices'][number]>();
  let currentNo = '';
  let currentDate: string | null = null;
  let rowsRead = 0;

  const numField = (
    raw: unknown,
    text: string,
    decimals: number,
    row: number,
    label: string,
  ): string => {
    const s =
      typeof raw === 'number' ? String(raw) : text.replace(/,/g, '').replace(/[^\d.-]/g, '');
    if (s === '') return '0';
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) {
      warnings.push({ row, message: `${label} "${text}" is not a valid number; used 0.` });
      return '0';
    }
    const rounded = Number(n.toFixed(decimals));
    if (rounded !== n)
      warnings.push({ row, message: `${label} ${text} rounded to ${decimals} decimals.` });
    return String(rounded);
  };

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (field: string) => {
      for (const [col, f] of columns) if (f === field) return row.getCell(col);
      return null;
    };
    const text = (field: string) => {
      const c = get(field);
      return c ? cellText(c) : '';
    };
    const lineFields = [
      'poNo',
      'styleNo',
      'htsCode',
      'pcs',
      'ctns',
      'cbm',
      'netWeightKg',
      'grossWeightKg',
      'fobUnitPrice',
      'description',
    ];
    if (!lineFields.some((f) => text(f) !== '') && !text('invoiceNo')) continue; // blank row
    rowsRead++;

    const invNo = text('invoiceNo').toUpperCase();
    if (invNo) {
      currentNo = invNo;
      const dc = get('invoiceDate');
      currentDate = dc ? parseDateCell(cellRaw(dc)) : null;
      if (dc && cellText(dc) && !currentDate)
        warnings.push({
          row: r,
          message: `Invoice date "${cellText(dc)}" not recognised; leave it as YYYY-MM-DD.`,
        });
    } else if (!currentNo) {
      currentNo = 'IMPORTED';
    }
    let inv = invoices.get(currentNo);
    if (!inv) {
      inv = { invoiceNo: currentNo, invoiceDate: currentDate, description: null, lines: [] };
      invoices.set(currentNo, inv);
    }
    const n = (field: string, decimals: number, label: string) => {
      const c = get(field);
      return c ? numField(cellRaw(c), cellText(c), decimals, r, label) : '0';
    };
    const description = text('description') || null;
    inv.description ??= description;
    inv.lines.push({
      poNo: text('poNo') || null,
      styleNo: text('styleNo') || null,
      htsCode: text('htsCode') || null,
      pcs: n('pcs', 3, 'PCS'),
      ctns: n('ctns', 3, 'CTNS'),
      cbm: n('cbm', 3, 'CBM'),
      netWeightKg: n('netWeightKg', 3, 'N.W'),
      grossWeightKg: n('grossWeightKg', 3, 'G.W'),
      fobUnitPrice: n('fobUnitPrice', 4, 'FOB price'),
      description,
    });
  }
  if (!rowsRead) warnings.push({ row: null, message: 'The sheet has a header but no data rows.' });
  // One invoice = one HTS code: fill blank lines from the invoice's code, and flag invoices
  // whose lines disagree so the user picks one in the form.
  for (const inv of invoices.values()) {
    const codes = invoiceHtsCodes(inv.lines);
    if (codes.length === 1) for (const l of inv.lines) l.htsCode = codes[0]!;
    else if (codes.length > 1)
      warnings.push({
        row: null,
        message: `Invoice ${inv.invoiceNo} has several HTS codes (${codes.join(', ')}); one invoice uses one HTS code — choose it in the form.`,
      });
  }
  return { invoices: [...invoices.values()], warnings, rowsRead };
}

/** The Export Template columns, in order, with the help shown on each header. */
const TEMPLATE_COLUMNS: { header: string; width: number; note: string }[] = [
  {
    header: 'INVOICE NO',
    width: 14,
    note: 'Cargo invoice no. Leave it empty on the next lines of the same invoice.',
  },
  { header: 'INV DATE', width: 12, note: 'Invoice date, e.g. 2026-09-10.' },
  { header: 'PO#', width: 12, note: '' },
  { header: 'STYLE', width: 14, note: '' },
  { header: 'HTS CODE', width: 11, note: 'One HTS code per invoice, e.g. 6204.69.' },
  { header: 'PCS', width: 9, note: 'Pieces.' },
  { header: 'CTNS', width: 8, note: 'Cartons.' },
  { header: 'CBM', width: 8, note: '' },
  { header: 'N.W KGS', width: 10, note: 'Net weight, kg.' },
  { header: 'G.W KGS', width: 10, note: 'Gross weight, kg.' },
  { header: 'FOB PRICE', width: 10, note: 'USD per piece.' },
  { header: 'DESCRIPTION', width: 40, note: 'e.g. LADIES WOVEN PANT 100% RAYON' },
];

/** The blank Export Template: the columns parseCargoWorkbook reads, with a note on each. */
export async function buildCargoTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grateful Solutions Logistics Command Center';
  const ws = wb.addWorksheet('Export Invoices', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
  head.alignment = { vertical: 'middle' };
  head.height = 20;
  TEMPLATE_COLUMNS.forEach((c, i) => {
    if (c.note) head.getCell(i + 1).note = c.note;
  });
  // Codes and dates stay as typed (HTS 6206.40 keeps its 0).
  for (const col of [1, 3, 4, 5]) ws.getColumn(col).numFmt = '@';
  ws.getColumn(2).numFmt = 'yyyy-mm-dd';
  return Buffer.from(await wb.xlsx.writeBuffer());
}
