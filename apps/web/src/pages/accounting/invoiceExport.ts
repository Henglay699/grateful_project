import type { Borders, Font, Workbook, Worksheet } from 'exceljs';
import {
  companyBanks,
  DEFAULT_VAT_PERCENT,
  fmtVatPercent,
  type BillingDoc,
  type BillingDocType,
} from '@gs/shared';
import type { CompanyInfo } from '../../features/accounting';
import { saveBlob } from '../../lib/files';
import { logoDataUrl } from './recordSummaryExport';

/*
 * Excel for a tax invoice, disbursement or debit note, laid out like its printed sheet
 * (print/InvoicePrint.tsx + invoicePrint.module.css): the same columns, fonts, rules and
 * places on an A4 page, one document per sheet. Totals are live formulas.
 */

export const INVOICE_EXCEL_TYPES: readonly BillingDocType[] = [
  'tax-invoices',
  'disbursements',
  'debit-notes',
];

const LABEL: Partial<Record<BillingDocType, string>> = {
  'tax-invoices': 'TaxInvoice',
  disbursements: 'Disbursement',
  'debit-notes': 'DebitNote',
};

/** "GS26-393", or "TaxInvoice_JR_draft" for a draft that has no number yet. */
export function invoiceFileName(d: BillingDoc): string {
  const name = d.number?.trim() || `${LABEL[d.type] ?? 'Doc'}_${d.clientCode || 'draft'}_draft`;
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The workbook as a file to save. */
export async function workbookBlob(wb: Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  const breaks = wb.worksheets.filter((ws) => colBreaks.has(ws));
  if (!breaks.length) return new Blob([buf], { type: XLSX_TYPE });
  // ExcelJS writes no column breaks: add them to the sheets' XML, where the schema puts them
  // (after any row breaks, before the drawing).
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);
  for (const ws of breaks) {
    const path = `xl/worksheets/sheet${ws.id}.xml`;
    const xml = await zip.file(path)!.async('string');
    const cols = colBreaks.get(ws)!;
    const tag =
      `<colBreaks count="${cols.length}" manualBreakCount="${cols.length}">` +
      cols.map((c) => `<brk id="${c}" max="1048575" man="1"/>`).join('') +
      '</colBreaks>';
    const at = xml.search(
      /<(customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|picture|oleObjects|controls|tableParts|extLst)\b|<\/worksheet>/,
    );
    zip.file(path, xml.slice(0, at) + tag + xml.slice(at));
  }
  return new Blob([await zip.generateAsync({ type: 'arraybuffer' })], { type: XLSX_TYPE });
}

/** Manual column breaks (a page ends after each column number), written by workbookBlob. */
const colBreaks = new WeakMap<Worksheet, number[]>();

/** One document as its own workbook. */
export async function exportInvoiceExcel(d: BillingDoc, c: CompanyInfo) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  addDocSheet(wb, d, c, await logoDataUrl(), invoiceFileName(d));
  saveBlob(await workbookBlob(wb), `${invoiceFileName(d)}.xlsx`);
}

/** A document's sheet; returns where its grand total is ("'GS26-360'!H30"), for formulas. */
export function addDocSheet(
  wb: Workbook,
  d: BillingDoc,
  c: CompanyInfo,
  logo: string | null,
  name: string,
): string {
  const ws = a4Sheet(wb, name, { left: 8, right: 8, top: 10, bottom: 10 }, true);
  return d.type === 'debit-notes'
    ? debitNote(ws, d)
    : taxOrDisbursement(wb, ws, d, c, logo, d.type === 'tax-invoices');
}

/**
 * A shipment's tax invoice and disbursement on one sheet, side by side (A–H, I–P) as in the
 * client's workbook, with a page break between them: two A4 pages. Returns both grand totals.
 */
export function addPairSheet(
  wb: Workbook,
  tax: BillingDoc,
  dis: BillingDoc,
  c: CompanyInfo,
  logo: string | null,
  name: string,
): [string, string] {
  const ws = a4Sheet(wb, name, { left: 8, right: 8, top: 10, bottom: 10 });
  // Excel ignores manual breaks on a sheet scaled to fit, so a fixed scale that keeps each
  // half on its page (the foot is pushed to A4_INVOICE_PT, which prints a little over A4).
  Object.assign(ws.pageSetup, { fitToPage: false, scale: 95 });
  const pair = { lines: Math.max(tax.lines.length, dis.lines.length) };
  const refs: [string, string] = [
    taxOrDisbursement(wb, ws, tax, c, logo, true, { ...pair, o: 0 }),
    taxOrDisbursement(wb, ws, dis, c, logo, false, { ...pair, o: 8 }),
  ];
  colBreaks.set(ws, [8]);
  return refs;
}

/* ------------------------------ Shared ------------------------------ */

export const EN = 'Arial'; // the sheets' Helvetica
export const KM = 'Khmer OS Siemreap';
export const MUOL = 'Khmer OS Muol';
export const f = (name: string, size: number, extra: Partial<Font> = {}): Partial<Font> => ({
  name,
  size,
  ...extra,
});
const edge = (style: 'thin' | 'medium' | 'thick' | 'double' | 'dashed', argb = 'FF000000') =>
  ({ style, color: { argb } }) as const;
export const THIN = edge('thin');
export const MEDIUM = edge('medium');
export const THICK = edge('thick');
export const DOUBLE = edge('double');
export const box = (e: Borders['top'] = THIN) => ({ top: e, left: e, bottom: e, right: e });
export const MONEY = '#,##0.00';
export const MONEY3 = '#,##0.000';
export const RIEL = '#,##0';
/** 02-JUN-2026 on the invoices, 03-Sep-2026 on the statements. */
export const DATE_UPPER = 'dd\\-mmm\\-yyyy';
export const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const h = (d: BillingDoc, k: string) => d.header[k] ?? '';
/** PKGS as printed: the quantity and its unit (629 CTNS). */
const pkgs = (d: BillingDoc) => [h(d, 'pkgs'), h(d, 'pkgsUnit')].filter(Boolean).join(' ');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** 2026-06-02 → 02-JUN-2026, as printed (text, so the month stays in capitals). */
export const longDate = (iso: string) => {
  const [y, m, day] = iso.split('-');
  return y && m && day ? `${day}-${MON[Number(m) - 1]}-${y}` : iso;
};
/** 2026-09-03 → a date cell (midnight UTC, the way ExcelJS writes it). */
export const dateCell = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : iso;
const fixed2 = (v: string) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kgs = (v: string) => (v ? `${fixed2(v)} KGS` : '');
const cbm = (v: string) =>
  v ? `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 })} CBM` : '';
/** The VOLUME line: always "NON" for a shipment by air (no CBM), import or export. */
const volume = (d: BillingDoc) =>
  h(d, 'transportMode') === 'AIR' ? 'NON' : cbm(h(d, 'volumeCbm'));

const MM = 1 / 25.4; // inches
/**
 * An A4 portrait sheet with the printed sheet's padding as its margins (mm), one page wide;
 * `onePage`: also one page tall (a document's sheet shrinks a little rather than spill over).
 * Opens in Page Break Preview, so the pages show as they print.
 */
export function a4Sheet(
  wb: Workbook,
  name: string,
  m: { left: number; right: number; top: number; bottom: number },
  onePage = false,
) {
  return wb.addWorksheet(sheetName(wb, name), {
    views: [{ showGridLines: false, style: 'pageBreakPreview', zoomScale: 100 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: onePage ? 1 : 0,
      horizontalCentered: true,
      margins: {
        left: m.left * MM,
        right: m.right * MM,
        top: m.top * MM,
        bottom: m.bottom * MM,
        header: 0,
        footer: 0,
      },
    },
  });
}

/** A valid, unused sheet name. */
function sheetName(wb: Workbook, name: string) {
  const base = name.replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'Sheet';
  let n = base;
  for (let i = 2; wb.getWorksheet(n); i++) n = `${base} (${i})`;
  return n;
}

/** Column widths from the printed sheet's pixels (Excel's width ≈ (px − 5) / 7). */
export const px = (...widths: number[]) =>
  widths.map((w) => ({ width: Math.max(0.5, Math.round(((w - 5) / 7) * 100) / 100) }));

/** The logo, added to the workbook once and shared by its sheets. */
const logos = new WeakMap<Workbook, number>();
export function logoImage(wb: Workbook, logo: string): number {
  let id = logos.get(wb);
  if (id === undefined) {
    id = wb.addImage({ base64: logo, extension: 'png' });
    logos.set(wb, id);
  }
  return id;
}

type Value = string | number | Date | { formula: string; result?: number | string } | null;
type Align = 'left' | 'center' | 'right';
type PutRest = Parameters<typeof put> extends [unknown, unknown, unknown, ...infer T] ? T : never;
/** Merge a row's span (when wider than one cell) and set its value and look. */
export function put(
  ws: Worksheet,
  row: number,
  [c1, c2]: [number, number],
  value: Value,
  font: Partial<Font>,
  horizontal: Align = 'left',
  extra: { numFmt?: string; wrap?: boolean; indent?: number; valign?: 'top' | 'bottom' } = {},
) {
  if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  if (value !== null && value !== '') cell.value = value as never;
  cell.font = font;
  cell.alignment = {
    horizontal,
    vertical: extra.valign ?? 'middle',
    wrapText: !!extra.wrap,
    ...(extra.indent ? { indent: extra.indent } : {}),
  };
  if (extra.numFmt) cell.numFmt = extra.numFmt;
  return cell;
}

/** Add a border to one side of every cell in a row's span. */
export function rule(
  ws: Worksheet,
  row: number,
  [c1, c2]: [number, number],
  side: keyof Borders,
  e: Borders['top'],
) {
  for (let col = c1; col <= c2; col++)
    ws.getCell(row, col).border = { ...ws.getCell(row, col).border, [side]: e };
}

export const height = (ws: Worksheet, row: number, pt: number) => {
  ws.getRow(row).height = pt;
};

/**
 * Pushes what follows to the page foot, like the sheet's "margin-top: auto": rows `row` and
 * `row + 1` share the height left on a `page`-point page after the rows above and `after`
 * points below (two rows, as Excel caps a row at 409 pt). Returns the row after them.
 */
export function pushToFoot(ws: Worksheet, row: number, after: number, page: number): number {
  let used = 0;
  for (let r = 1; r < row; r++) used += ws.getRow(r).height ?? 15;
  const gap = Math.min(818, Math.max(12, page - used - after));
  height(ws, row, gap / 2);
  height(ws, row + 1, gap / 2);
  return row + 2;
}

/** DRAFT / CANCELLED in red at the top right, for the sheet's faint stamp. */
export function stamp(ws: Worksheet, row: number, col: number, status: string) {
  if (status === 'ISSUED') return;
  put(
    ws,
    row,
    [col, col],
    status === 'VOID' ? 'CANCELLED' : status,
    f(EN, 14, {
      bold: true,
      color: { argb: 'FFDC2626' },
    }),
    'right',
  );
}

/**
 * The page height the foot is pushed to (points). Measured on Excel's own print: the rows
 * print a little shorter than A4 less the 10 mm margins (785 pt) suggests, so this is above
 * it; the sheet is also set to one page tall, so it never spills over.
 */
const A4_INVOICE_PT = 820;

/**
 * The letterhead: logo on the left; the company in Khmer and English, VATTIN, address and
 * phone centred (tax invoice, disbursement and the invoices statement). Returns the next row.
 */
export function masthead(
  wb: Workbook,
  ws: Worksheet,
  c: CompanyInfo,
  logo: string | null,
  cols: number,
  row = 1,
  /** Columns to the left of it (the second document on a shared sheet). */
  col0 = 0,
): number {
  const all: [number, number] = [1 + col0, cols + col0];
  put(ws, row, all, c.nameKm ?? '', f(MUOL, 13.5), 'center');
  put(ws, row + 1, all, c.nameEn ?? '', f(EN, 11.5, { bold: true }), 'center');
  put(
    ws,
    row + 2,
    all,
    `លេខអត្តសញ្ញាណកម្ម អតប (VATTIN) : ${c.vattin ?? ''}`,
    f(KM, 9.5, { bold: true }),
    'center',
  );
  put(ws, row + 3, all, `អាស័យដ្ឋាន : ${c.addressKm ?? ''}`, f(KM, 8), 'center', { wrap: true });
  put(ws, row + 4, all, `លេខទូរស័ព្ទ: ${c.phone ?? ''}`, f(KM, 8), 'center');
  [26, 18, 17, 24, 14].forEach((pt, i) => height(ws, row + i, pt));
  if (logo)
    ws.addImage(logoImage(wb, logo), {
      tl: { col: col0 + 0.25, row: row - 1 },
      ext: { width: 120, height: 120 },
    });
  return row + 5;
}

/* ------------------------- Tax invoice / disbursement ------------------------- */

function taxOrDisbursement(
  wb: Workbook,
  ws: Worksheet,
  d: BillingDoc,
  c: CompanyInfo,
  logo: string | null,
  tax: boolean,
  /** Beside another document (see addPairSheet): its first column less one, and the line
   * rows both lay out, so their totals and signatures fall on the same rows. */
  pair: { o: number; lines: number } = { o: 0, lines: 0 },
): string {
  const { o } = pair;
  const P = (row: number, [c1, c2]: [number, number], ...rest: PutRest) =>
    put(ws, row, [c1 + o, c2 + o], ...rest);
  const RL = (row: number, [c1, c2]: [number, number], side: keyof Borders, e: Borders['top']) =>
    rule(ws, row, [c1 + o, c2 + o], side, e);
  // A row keeps the taller of the two documents' heights.
  const ht = (row: number, pt: number) =>
    height(ws, row, Math.max(pt, (o && ws.getRow(row).height) || 0));
  const [C, E, F, G, H] = [3, 5, 6, 7, 8].map((n) => ws.getColumn(n + o).letter) as [
    string,
    string,
    string,
    string,
    string,
  ];
  // The invoice's own VAT percent, as printed (10 unless Settings → Tax Management changed it).
  const vat = fmtVatPercent(d.header.vatRate ?? DEFAULT_VAT_PERCENT);
  // The sheet's columns (px): No, Description, Quantity, Unit, Unit Price, Sub Total, VAT, Amount.
  px(32, 313, 55, 48, 70, 75, 65, 75).forEach((w, i) => (ws.getColumn(i + 1 + o).width = w.width));
  const ALL: [number, number] = [1, 8];
  // Row 1: room for the DRAFT / CANCELLED mark.
  stamp(ws, 1, 8 + o, d.status);
  ht(1, 14);
  let r = masthead(wb, ws, c, logo, 8, 2, o);

  // Title between the heavy rule and the details.
  ht(r, 12);
  RL(r + 1, ALL, 'top', THICK);
  P(r + 1, ALL, tax ? 'វិក្កយបត្រអាករ' : 'វិក្កយបត្របង់ជំនួស', f(MUOL, 14), 'center');
  ht(r + 1, 28);
  P(r + 2, ALL, tax ? 'TAX INVOICE' : 'DISBURSEMENT', f(EN, 13, { bold: true }), 'center');
  ht(r + 2, 19);
  ht(r + 3, 12);
  r += 4;

  // Customer on the left (A–D), document and shipment on the right (E–H), right-aligned.
  // As on the sheet: 1.25fr to 1fr, so the right side has room for the Khmer labels.
  const L: [number, number] = [1, 3];
  const R: [number, number] = [4, 8];
  const val = f(EN, 10);
  const ship = f(EN, 9);
  const kmLbl = f(KM, 10);
  type Part = { text: string; font: Partial<Font> };
  const left: (Part[] | string)[] = [
    [
      { text: 'ឈ្មោះអតិថិជន', font: f(MUOL, 8.8) },
      { text: ' / Customer:', font: f(EN, 10, { bold: true }) },
      { text: ` ${h(d, 'customerNameKm')}`, font: f(MUOL, 10) },
    ],
    [{ text: h(d, 'customerNameEn'), font: f(EN, 10, { bold: true }) }],
    [
      { text: 'អាស័យដ្ឋាន / Address: ', font: kmLbl },
      { text: h(d, 'customerAddress'), font: val },
    ],
    [
      { text: 'លេខ អតប (VATTIN) : ', font: kmLbl },
      { text: h(d, 'customerVattin'), font: val },
    ],
    `SHIPPER: ${h(d, 'shipper')}`,
    `CONSIGNEE: ${h(d, 'consignee')}`,
    `HBL: ${h(d, 'hbl')}`,
    `PKGS: ${pkgs(d)}`,
  ];
  const right: (Part[] | string)[] = [
    [
      { text: tax ? 'លេខវិក្កយបត្រ / Invoice No: ' : 'លេខផ្តល់ប័ត្រ / DIS-No: ', font: kmLbl },
      { text: d.number ?? '', font: val },
    ],
    [
      {
        text: tax ? 'កាលបរិច្ឆេទវិក្កយបត្រ / Invoice Date: ' : 'ការបញ្ជូនផ្តល់ប័ត្រ / DIS-Date: ',
        font: kmLbl,
      },
      { text: longDate(d.date), font: val },
    ],
    '', // one blank line before the shipment details, as on the sheet
    `GROSS WEIGHT: ${kgs(h(d, 'grossWeightKg'))}`,
    `VOLUME: ${volume(d)}`,
    `Container No: ${h(d, 'containerNo')}`,
    `POL: ${h(d, 'pol').toUpperCase()}`,
    `POD: ${h(d, 'pod').toUpperCase()}`,
    `Exchange Rate: 1USD = ${Math.round(num(h(d, 'exchangeRate'))).toLocaleString('en-US')} KHR`,
  ];
  const text = (v: Part[] | string) => (typeof v === 'string' ? v : v.map((p) => p.text).join(''));
  const meta = (v: Part[] | string) => (typeof v === 'string' ? v : { richText: v });
  for (let i = 0; i < Math.max(left.length, right.length); i++, r++) {
    const lv = left[i] ?? '';
    const rv = right[i] ?? '';
    P(r, L, null, ship, 'left', { wrap: true });
    P(r, R, null, ship, 'right', { wrap: true });
    if (text(lv)) ws.getCell(r, o + 1).value = meta(lv) as never;
    if (text(rv)) ws.getCell(r, o + 4).value = meta(rv) as never;
    const lines = Math.max(Math.ceil(text(lv).length / 68), Math.ceil(text(rv).length / 58), 1);
    ht(r, (i === 3 ? 18 : 15) * lines);
  }
  ht(r, 10);
  r += 1;

  // Lines: a 2px rule above and below the two-line headings.
  const heads: [string, string, Align][] = [
    ['ល.រ', 'No', 'center'],
    ['បរិយាយមុខទំនិញ', 'Description', 'center'],
    ['បរិមាណ', 'Quantity', 'center'],
    ['ឯកតា', 'Unit', 'center'],
    ['ថ្លៃឯកតា', 'Unit Price', 'right'],
    ['សរុប', 'Sub Total', 'right'],
    tax ? [`អាករ ${vat}%`, `VAT (${vat}%)`, 'right'] : ['អាករ (0%)', 'VAT (0%)', 'right'],
    ['ថ្លៃទំនិញ', 'Amount', 'right'],
  ];
  heads.forEach(([k, e, align], i) => {
    const cell = P(r, [i + 1, i + 1], null, f(EN, 8, { bold: true }), align, { wrap: true });
    cell.value = {
      richText: [
        { text: `${k}\n`, font: f(KM, 8, { bold: true }) },
        { text: e, font: f(EN, 8, { bold: true }) },
      ],
    };
  });
  RL(r, ALL, 'top', MEDIUM);
  RL(r, ALL, 'bottom', MEDIUM);
  ht(r, 30);
  r += 1;

  const first = r;
  for (const l of d.lines) {
    const align: Align[] = [
      'center',
      'left',
      'center',
      'center',
      'right',
      'right',
      'right',
      'right',
    ];
    const values: Value[] = [
      l.lineNo,
      l.description,
      num(l.qty),
      l.unit ?? '',
      num(l.unitPrice),
      { formula: `ROUND(${C}${r}*${E}${r},2)`, result: num(l.subtotal) },
      // A line the system charges no VAT on keeps its 0; the rest are the VAT % of the sub total.
      tax && num(l.vat) !== 0
        ? { formula: `ROUND(${F}${r}*${Number(vat) / 100},2)`, result: num(l.vat) }
        : tax
          ? 0
          : '-',
      {
        formula: tax ? `${F}${r}+${G}${r}` : `${F}${r}`,
        result: tax ? num(l.amount) : num(l.subtotal),
      },
    ];
    values.forEach((v, i) =>
      P(r, [i + 1, i + 1], v, f(EN, 8, { bold: i === 7 }), align[i], {
        wrap: i === 1,
        numFmt: i === 2 || i >= 4 ? MONEY : undefined,
      }),
    );
    ht(r, 22 * Math.max(1, Math.ceil(l.description.length / 50)));
    r += 1;
  }
  const last = r - 1;
  r = Math.max(r, first + pair.lines); // blank rows to line up with the other document
  const sum = (col: string, result: number) =>
    d.lines.length ? { formula: `SUM(${col}${first}:${col}${last})`, result } : 0;

  // Totals between double rules: KHR and USD on the tax invoice, USD only on the disbursement.
  ht(r, 3);
  r += 1;
  const top = r;
  const bold = f(EN, 8.2, { bold: true });
  const label = (text: string) =>
    P(r, tax ? [1, 3] : [1, 6], text, f(KM, 8.2, { bold: true }), 'right', { indent: 1 });
  if (tax) {
    const rate = num(h(d, 'exchangeRate'));
    const rows: [string, Value, number][] = [
      ['សរុប SUB TOTAL', sum(F, num(d.totals.subtotal)), num(d.totals.subtotalKhr)],
      [`អាករលើតម្លៃបន្ថែម (VAT ${vat}%)`, sum(G, num(d.totals.vat)), num(d.totals.vatKhr)],
      [
        'សរុបរួម GRAND TOTAL',
        { formula: `${H}${top}+${H}${top + 1}`, result: num(d.totals.total) },
        num(d.totals.totalKhr),
      ],
    ];
    for (const [text, usd, khr] of rows) {
      label(text);
      P(r, [4, 4], 'KHR', bold, 'center');
      P(r, [6, 6], { formula: `ROUND(${H}${r}*${rate},0)`, result: khr }, bold, 'right', {
        numFmt: RIEL,
      });
      P(r, [7, 7], 'USD', bold, 'right');
      P(r, [8, 8], usd, bold, 'right', { numFmt: MONEY });
      ht(r, 17);
      r += 1;
    }
  } else {
    const total = num(d.totals.total);
    const rows: [string, Value][] = [
      ['សរុប SUB TOTAL', sum(H, total)],
      ['អាករលើតម្លៃបន្ថែម (VAT 0%)', '-'],
      ['សរុបរួម GRAND TOTAL', { formula: `${H}${top}`, result: total }],
    ];
    for (const [text, usd] of rows) {
      label(text);
      P(r, [7, 7], 'USD', bold, 'right');
      P(r, [8, 8], usd, bold, 'right', { numFmt: MONEY });
      ht(r, 17);
      r += 1;
    }
  }
  RL(top, ALL, 'top', DOUBLE);
  RL(r - 1, ALL, 'bottom', DOUBLE);
  const grand = `'${ws.name}'!${H}${r - 1}`;
  ht(r, 16);
  r += 1;

  // Payment note
  const banks = companyBanks(c);
  for (const t of [
    'Note: You can make payment by cross cheque to:',
    banks[0]?.accountName ?? '',
    'or Deposit Cash/Cheque payment to bank as below:',
    ...banks.flatMap((b) => [b.bankName, `AC/NAME: ${b.accountName}`, `AC/NO: ${b.accountNo}`]),
  ]) {
    P(r, ALL, t, f(EN, 7.8));
    ht(r, 11.5);
    r += 1;
  }

  // Signatures at the page foot: a 2px rule over each, buyer left, seller right.
  r = pushToFoot(ws, r, 24 + 18 + 12 + 12, A4_INVOICE_PT);
  RL(r, [1, 2], 'bottom', MEDIUM);
  RL(r, [6, 8], 'bottom', MEDIUM);
  ht(r, 24);
  P(r + 1, [1, 3], 'ហត្ថលេខា និង ឈ្មោះអ្នកទិញ', f(KM, 10));
  P(r + 1, [6, 8], 'ហត្ថលេខា និង ឈ្មោះអ្នកលក់', f(KM, 10), 'right');
  ht(r + 1, 18);
  const grey = { argb: 'FF444444' };
  P(
    r + 2,
    [1, 3],
    'សម្គាល់ច្បាប់ដើមសម្រាប់អ្នកទិញច្បាប់ចម្លងសម្រាប់អ្នកលក់',
    f(KM, 7.5, { color: grey }),
  );
  P(
    r + 3,
    [1, 3],
    'Note : Original invoice for customer, copies invoice for seller',
    f(EN, 7.5, { color: grey }),
  );
  ht(r + 2, 12);
  ht(r + 3, 12);
  ws.pageSetup.printArea = `A1:${H}${r + 3}`;
  return grand;
}

/* ------------------------------ Debit note ------------------------------ */

function debitNote(ws: Worksheet, d: BillingDoc): string {
  // NO, DESCRIPTION, Q'TY, U/M, PRICE, TOTAL (px, as on the sheet).
  ws.columns = px(28, 445, 45, 55, 75, 85);
  const ALL: [number, number] = [1, 6];
  stamp(ws, 1, 6, d.status);
  put(ws, 2, ALL, 'DEBIT NOTE', f(EN, 14, { bold: true, underline: true }), 'center');
  height(ws, 2, 22);
  height(ws, 3, 35); // the space under the headline

  // Laid out like the tax invoice's details, in English only. A debit note of no shipment
  // (e.g. the monthly MIH / payroll fee) shows what it charges.
  const shipment = !!(h(d, 'hbl') || h(d, 'containerNo') || h(d, 'shipper'));
  const val = f(EN, 10);
  const left: ({ text: string; font: Partial<Font> }[] | string)[] = [
    [
      { text: 'Customer: ', font: f(EN, 10, { bold: true }) },
      { text: h(d, 'billTo'), font: f(EN, 10, { bold: true }) },
    ],
    [
      { text: 'Address: ', font: val },
      { text: h(d, 'address'), font: val },
    ],
    ...(shipment
      ? [
          `SHIPPER: ${h(d, 'shipper')}`,
          `CONSIGNEE: ${h(d, 'consignee')}`,
          `HBL: ${h(d, 'hbl')}`,
          `PKGS: ${pkgs(d)}`,
        ]
      : [`CHARGE: ${h(d, 'reference')}`]),
  ];
  const right: ({ text: string; font: Partial<Font> }[] | string)[] = [
    [
      { text: 'DN No: ', font: val },
      { text: d.number ?? '', font: val },
    ],
    [
      { text: 'DN Date: ', font: val },
      { text: longDate(d.date), font: val },
    ],
    ...(shipment
      ? [
          `GROSS WEIGHT: ${kgs(h(d, 'grossWeightKg'))}`,
          `VOLUME: ${volume(d)}`,
          `Container No: ${h(d, 'containerNo')}`,
          `POL: ${h(d, 'pol').toUpperCase()}`,
          `POD: ${h(d, 'pod').toUpperCase()}`,
        ]
      : []),
  ];
  const text = (v: (typeof left)[number]) =>
    typeof v === 'string' ? v : v.map((p) => p.text).join('');
  let r = 4;
  for (let i = 0; i < Math.max(left.length, right.length); i++, r++) {
    const lv = left[i] ?? '';
    const rv = right[i] ?? '';
    put(ws, r, [1, 2], null, f(EN, 9), 'left', { wrap: true });
    put(ws, r, [3, 6], null, f(EN, 9), 'right', { wrap: true });
    if (text(lv))
      ws.getCell(r, 1).value = (typeof lv === 'string' ? lv : { richText: lv }) as never;
    if (text(rv))
      ws.getCell(r, 3).value = (typeof rv === 'string' ? rv : { richText: rv }) as never;
    height(ws, r, 15 * Math.max(1, Math.ceil(text(lv).length / 70)));
  }
  height(ws, r, 28); // one blank line before the table
  r += 1;

  // The table: every cell ruled.
  ['NO', 'DESCRIPTION', "Q'TY", 'U/M', 'PRICE', 'TOTAL'].forEach((t, i) =>
    Object.assign(put(ws, r, [i + 1, i + 1], t, f(EN, 9, { bold: true }), 'center'), {
      border: box(),
    }),
  );
  height(ws, r, 16);
  r += 1;
  const first = r;
  for (const l of d.lines) {
    const align: Align[] = ['center', 'left', 'center', 'center', 'right', 'right'];
    const values: Value[] = [
      l.lineNo,
      l.description,
      num(l.qty),
      l.unit ?? '',
      num(l.unitPrice),
      { formula: `ROUND(C${r}*E${r},2)`, result: num(l.subtotal) },
    ];
    values.forEach((v, i) =>
      Object.assign(
        put(ws, r, [i + 1, i + 1], v, f(EN, 9), align[i], {
          wrap: i === 1,
          numFmt: i >= 4 ? MONEY : undefined,
        }),
        { border: box() },
      ),
    );
    height(ws, r, 15 * Math.max(1, Math.ceil(l.description.length / 75)));
    r += 1;
  }
  const bold = f(EN, 9, { bold: true });
  put(ws, r, [1, 4], 'GRAND TOTAL:', bold, 'right', { indent: 1 });
  put(ws, r, [5, 5], 'USD', bold, 'center');
  put(
    ws,
    r,
    [6, 6],
    d.lines.length
      ? { formula: `SUM(F${first}:F${r - 1})`, result: num(d.totals.total) }
      : num(d.totals.total),
    bold,
    'right',
    { numFmt: MONEY },
  );
  for (let col = 1; col <= 6; col++) ws.getCell(r, col).border = { ...box(), top: MEDIUM };
  height(ws, r, 16);
  const grand = `'${ws.name}'!F${r}`;

  // Footer at the page foot.
  const footRow = pushToFoot(ws, r + 1, 16, A4_INVOICE_PT);
  const foot = f(EN, 9, { bold: true, underline: true });
  put(ws, footRow, [1, 2], 'Thank you for your supporting', foot);
  put(ws, footRow, [4, 6], 'AUTHORIZED SIGNATURE', foot, 'right');
  height(ws, footRow, 16);
  ws.pageSetup.printArea = `A1:F${footRow}`;
  return grand;
}
