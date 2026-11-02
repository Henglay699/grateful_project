import type { Workbook, Worksheet } from 'exceljs';
import {
  amountInWords,
  type BillingPack,
  type BillingStatement,
  type PaymentMethod,
} from '@gs/shared';
import type { CompanyInfo } from '../../features/accounting';
import { api } from '../../lib/api';
import { saveBlob } from '../../lib/files';
import { checklistRows, statementReceipts, type ReceiptView } from '../print/PrintBillingPage';
import { periodCode, periodRange, type PackPart } from './billingUi';
import {
  a4Sheet,
  addDocSheet,
  addPairSheet,
  box,
  dateCell,
  EN,
  f,
  height,
  invoiceFileName,
  logoImage,
  masthead,
  MONEY,
  MONEY3,
  num,
  put,
  px,
  rule,
  stamp,
  THICK,
  THIN,
  workbookBlob,
} from './invoiceExport';
import { logoDataUrl } from './recordSummaryExport';

/*
 * A client's month as one workbook, laid out like the printed month pack
 * (print/PrintBillingPage.tsx + billingPrint.module.css): each document's sheet (a shipment's
 * tax invoice and disbursement side by side on one, a page each), the two
 * account statements (amounts linked to the document sheets), the official receipts (two A5
 * receipts to an A4 page) and the handover checklist. Same parts and documents as the print.
 */

/** "JR_SEP-2026_Pack". */
export const packFileName = (code: string, month: string) =>
  `${code}_${periodCode(month)}_Pack`.replace(/[^A-Za-z0-9._-]+/g, '_');

const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());

export async function exportPackExcel(opts: {
  clientId: string;
  month: string;
  parts: readonly PackPart[];
  preparedBy: string;
  /** One shipment's row: its tax invoice, disbursement and debit note only. */
  record?: { id: string; label: string };
}) {
  const [pack, company, logo, { default: ExcelJS }] = await Promise.all([
    api<BillingPack>(`/accounting/billing/${opts.clientId}/pack`, {
      query: { month: opts.month, recordId: opts.record?.id },
    }),
    api<CompanyInfo>('/meta/company'),
    logoDataUrl(),
    import('exceljs'),
  ]);
  const wb = new ExcelJS.Workbook();
  const parts = opts.record ? (['docs'] as const) : opts.parts;
  buildPackWorkbook(wb, pack, company, logo, opts.month, parts, opts.preparedBy, todayIso());
  if (!wb.worksheets.length) throw new Error('Nothing to export for these choices yet.');
  const name = opts.record
    ? `${pack.client.code}_${opts.record.label}`.replace(/[^A-Za-z0-9._-]+/g, '_')
    : packFileName(pack.client.code, opts.month);
  saveBlob(await workbookBlob(wb), `${name}.xlsx`);
}

export function buildPackWorkbook(
  wb: Workbook,
  pack: BillingPack,
  c: CompanyInfo,
  logo: string | null,
  month: string,
  parts: readonly PackPart[],
  preparedBy: string,
  today: string,
) {
  const on = (k: PackPart) => parts.includes(k);
  // Each document's grand total cell, by number, for the statements' formulas.
  const totals = new Map<string, string>();
  if (on('docs'))
    for (let i = 0; i < pack.docs.length; i++) {
      const d = pack.docs[i]!;
      // A shipment's tax invoice and the disbursement after it share a sheet, as in the
      // client's workbook.
      const next = pack.docs[i + 1];
      if (
        d.type === 'tax-invoices' &&
        next?.type === 'disbursements' &&
        d.accountingRecordId &&
        next.accountingRecordId === d.accountingRecordId
      ) {
        const name = `${invoiceFileName(d)} & ${invoiceFileName(next)}`;
        const [a, b] = addPairSheet(wb, d, next, c, logo, name);
        if (d.number) totals.set(d.number, a);
        if (next.number) totals.set(next.number, b);
        i += 1;
        continue;
      }
      const ref = addDocSheet(wb, d, c, logo, invoiceFileName(d));
      if (d.number) totals.set(d.number, ref);
    }
  for (const kind of ['INVOICE', 'DEBIT_NOTE'] as const)
    if (on(`st-${kind}`) && pack.statements[kind].lines.length)
      statementSheet(wb, pack, month, kind === 'INVOICE', c, logo, totals);
  const receipts = (['INVOICE', 'DEBIT_NOTE'] as const)
    .filter((kind) => on('receipts') || parts.includes(`rc-${kind}` as PackPart))
    .flatMap((kind) => statementReceipts(pack, month, kind));
  if (receipts.length) receiptSheet(wb, receipts, c, logo);
  if (on('checklist')) checklistSheet(wb, pack, month, c, preparedBy, today);
}

/* ------------------------------ Account statements ------------------------------ */

/** As printed: ST-INV with the invoice's letterhead, STA-DN with none. */
function statementSheet(
  wb: Workbook,
  pack: BillingPack,
  month: string,
  inv: boolean,
  c: CompanyInfo,
  logo: string | null,
  totals: Map<string, string>,
) {
  const st: BillingStatement = pack.statements[inv ? 'INVOICE' : 'DEBIT_NOTE'];
  const ws = a4Sheet(wb, inv ? 'Statement INV' : 'Statement DN', {
    left: 8,
    right: 8,
    top: 10,
    bottom: 10,
  });
  ws.columns = inv ? px(40, 95, 110, 110, 200, 70, 108) : px(40, 100, 140, 250, 80, 123);
  const n = inv ? 7 : 6;
  const ALL: [number, number] = [1, n];
  // Printed for checking before the documents are issued.
  stamp(ws, 1, n, st.drafts > 0 ? 'DRAFT' : 'ISSUED');
  height(ws, 1, 14);
  let r = inv ? masthead(wb, ws, c, logo, n, 2) : 2;
  height(ws, r, 16);
  put(ws, r + 1, ALL, 'Account Statement', f(EN, 17, { bold: true }), 'center');
  height(ws, r + 1, 24);
  put(ws, r + 2, ALL, `Date: ${periodRange(month)}`, f(EN, 10.5, { bold: true }), 'center');
  height(ws, r + 2, 16);
  height(ws, r + 3, 16);
  r += 4;

  // Bill to: the name in bold over the address, in the left 62%.
  const name = (pack.client.legalName ?? pack.client.name).toUpperCase();
  const address = (pack.client.address ?? '').toUpperCase();
  const span: [number, number] = [1, inv ? 5 : 4];
  put(ws, r, span, name, f(EN, 9, { bold: true }));
  height(ws, r, 14);
  put(ws, r + 1, span, address, f(EN, 8), 'left', { wrap: true, valign: 'top' });
  height(ws, r + 1, 12 * Math.max(1, Math.ceil(address.length / 85)));
  height(ws, r + 2, 14);
  r += 3;

  // A boxed table: ruled heading cells, open rows, the balance between a thin and a heavy rule.
  const heads = inv
    ? ['No:', 'Date', 'INV Number', 'DISBURSEMENT', 'REF #', 'Currency', 'Amount']
    : ['NO:', 'DATE', 'DN NUMBER', 'REF NO:', 'CURRENCY', 'AMOUNT'];
  const cell = f(EN, 8.5);
  heads.forEach((t, i) =>
    Object.assign(put(ws, r, [i + 1, i + 1], t, cell, 'center'), { border: box() }),
  );
  height(ws, r, 15);
  ws.pageSetup.printTitlesRow = `${r}:${r}`; // the headings again on each page
  const sides = (row: number) => {
    ws.getCell(row, 1).border = { ...ws.getCell(row, 1).border, left: THIN };
    ws.getCell(row, n).border = { ...ws.getCell(row, n).border, right: THIN };
  };
  height(ws, r + 1, 5);
  sides(r + 1);
  r += 2;
  const first = r;
  st.lines.forEach((l, i) => {
    // A shipment billed on its disbursement only has no tax invoice: "NON".
    const docs = inv ? [l.invNo || 'NON', l.disNo ?? ''] : [l.dnNo ?? ''];
    const values = [i + 1, dateCell(l.date), ...docs, l.ref ?? 'NON', 'USD'];
    values.forEach((v, j) =>
      put(ws, r, [j + 1, j + 1], v, cell, 'center', j === 1 ? { numFmt: 'dd\\-mmm\\-yyyy' } : {}),
    );
    // Linked to the documents' sheets when they are in the workbook.
    const nums = (inv ? [l.invNo, l.disNo] : [l.dnNo]).filter((x): x is string => !!x);
    const refs = nums.map((x) => totals.get(x));
    const amount =
      nums.length && refs.every(Boolean)
        ? { formula: refs.length > 1 ? `SUM(${refs.join(',')})` : refs[0]!, result: num(l.amount) }
        : num(l.amount);
    put(ws, r, [n, n], amount, cell, 'right', { numFmt: MONEY3 });
    sides(r);
    height(ws, r, 14);
    r += 1;
  });
  height(ws, r, 9);
  sides(r);
  const col = ws.getColumn(n).letter;
  r += 1;
  const bold = f(EN, 8.5, { bold: true });
  put(
    ws,
    r,
    [2, n - 2],
    {
      richText: [
        { text: 'BALANCE AS  ', font: bold },
        { text: periodCode(month), font: bold },
      ],
    } as never,
    bold,
  );
  put(
    ws,
    r,
    [n, n],
    { formula: `SUM(${col}${first}:${col}${r - 1})`, result: num(st.total) },
    bold,
    'right',
    {
      numFmt: MONEY3,
    },
  );
  rule(ws, r, ALL, 'top', THIN);
  rule(ws, r, ALL, 'bottom', THICK);
  sides(r);
  height(ws, r, 17);
  ws.pageSetup.printArea = `A1:${col}${r}`;
}

/* ------------------------------ Official receipts ------------------------------ */

/** The receipt's payment boxes, in the sheet's order and wording. */
const METHODS: [PaymentMethod, string][] = [
  ['BANK_TRANSFER', 'BANK'],
  ['CASH', 'CASH'],
  ['CHEQUE', 'CHEQUE'],
];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-09-30 → 30-Sep-26, the receipt's date. */
const receiptDate = (iso: string) =>
  `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
const PT_PER_MM = 72 / 25.4;

/** Two A5-landscape receipts to each A4 page, a dashed line between them, as printed. */
function receiptSheet(wb: Workbook, receipts: ReceiptView[], c: CompanyInfo, logo: string | null) {
  // The receipt's own padding (8 mm top, 14 mm sides, 7 mm bottom) is the page margin.
  const ws = a4Sheet(wb, 'Receipts', { left: 14, right: 14, top: 8, bottom: 7 });
  // Label 30 mm · 4 mm · field (50% − 13 mm = 78 mm) · 4 mm · the date side (66 mm).
  ws.columns = px(...[30, 4, 44, 34, 4, 30, 12, 24].map((mm) => mm * 3.78));
  let r = 1;
  receipts.forEach((rc, i) => {
    const start = r;
    r = receiptBlock(wb, ws, r, rc, c, logo);
    // Each receipt is 148 mm tall: fill to that, less the padding between the two.
    fillBlock(ws, start, r, (148 - 15) * PT_PER_MM);
    r += 1;
    if (i % 2 === 0 && i < receipts.length - 1) {
      // The 7 mm under this receipt, the dashed line, the 8 mm over the next.
      height(ws, r, 7 * PT_PER_MM);
      rule(ws, r, [1, 8], 'bottom', { style: 'dashed', color: { argb: 'FF9CA3AF' } });
      height(ws, r + 1, 8 * PT_PER_MM);
      r += 2;
    } else if (i < receipts.length - 1) ws.getRow(r - 1).addPageBreak();
  });
  ws.pageSetup.printArea = `A1:H${r - 1}`;
}

/** Sets row `fill`'s height so rows `start`…`fill` take `total` points (one receipt). */
function fillBlock(ws: Worksheet, start: number, fill: number, total: number) {
  let used = 0;
  for (let row = start; row < fill; row++) used += ws.getRow(row).height ?? 15;
  height(ws, fill, Math.min(409, Math.max(4, total - used)));
}

/** One receipt from `s`; returns the row left for filling to the receipt's height. */
function receiptBlock(
  wb: Workbook,
  ws: Worksheet,
  s: number,
  rc: ReceiptView,
  c: CompanyInfo,
  logo: string | null,
): number {
  const ALL: [number, number] = [1, 8];
  const t9 = f(EN, 9);
  let r = s;
  // As on the Excel OR-INV sheet: the invoices receipt has the letterhead, the DN one none.
  if (rc.kind !== 'DEBIT_NOTE') {
    height(ws, r, 22);
    put(ws, r + 1, ALL, c.nameEn ?? '', f(EN, 13, { bold: true }), 'center');
    height(ws, r + 1, 20);
    put(ws, r + 2, ALL, `( VATTIN ) : ${c.vattin ?? ''}`, f(EN, 8.5), 'center');
    height(ws, r + 2, 14);
    height(ws, r + 3, 16);
    if (logo)
      ws.addImage(logoImage(wb, logo), {
        tl: { col: 0, row: r - 1 },
        ext: { width: 96, height: 96 },
      });
    r += 4;
  }
  height(ws, r, 6);
  put(ws, r + 1, ALL, 'OFFICIAL RECEIPT', f(EN, 13, { bold: true, underline: true }), 'center');
  height(ws, r + 1, 18);
  const mark = rc.status === 'VOID' ? 'VOID' : rc.draft ? 'DRAFT' : 'ISSUED';
  stamp(ws, r + 1, 8, mark);
  height(ws, r + 2, 12);
  r += 3;

  const field = (row: number, span: [number, number]) => rule(ws, row, span, 'bottom', THIN);
  const line = (label: string) => {
    put(ws, r, [1, 1], label, t9, 'left', { valign: 'bottom' });
    height(ws, r, 21);
  };
  const bottom = { valign: 'bottom' as const };
  line('Received from');
  put(ws, r, [3, 4], `: ${rc.receivedFrom}`, f(EN, 9, { bold: true }), 'left', bottom);
  field(r, [3, 4]);
  put(ws, r, [7, 7], 'Date:', t9, 'left', bottom);
  put(ws, r, [8, 8], receiptDate(rc.receiptDate), t9, 'right', bottom);
  field(r, [7, 8]);
  r += 1;
  line('Amount');
  put(ws, r, [3, 3], ': $', f(EN, 10, { bold: true }), 'left', bottom);
  put(ws, r, [4, 4], num(rc.amount), f(EN, 10, { bold: true }), 'right', {
    ...bottom,
    numFmt: MONEY,
  });
  field(r, [3, 4]);
  r += 1;
  line('Amount in word');
  put(ws, r, [3, 8], `: ${amountInWords(rc.amount)}`, t9, 'left', { ...bottom, wrap: true });
  field(r, [3, 8]);
  r += 1;
  line('Received for');
  put(
    ws,
    r,
    [3, 3],
    `: ${periodCode(rc.month)}${rc.note ? ` · ${rc.note}` : ''}`,
    t9,
    'left',
    bottom,
  );
  field(r, [3, 3]);
  r += 1;
  line('Payment Method');
  const methods = METHODS.map(([m, label]) => `${rc.paymentMethod === m ? '☑' : '☐'} ${label}`);
  put(
    ws,
    r,
    [3, 4],
    `:  ${methods.join('      ')}${rc.paymentRef ? `      REF: ${rc.paymentRef}` : ''}`,
    t9,
    'left',
    bottom,
  );
  field(r, [3, 4]);
  r += 1;

  // A rule across, then "Received by:" and the signature on the right.
  height(ws, r, 12);
  rule(ws, r, ALL, 'bottom', THIN);
  height(ws, r + 1, 6);
  r += 2;
  put(ws, r, [6, 7], 'Received by:', t9, 'right', { indent: 2 });
  height(ws, r, 14);
  height(ws, r + 1, 34 * PT_PER_MM - 28);
  put(
    ws,
    r + 2,
    [6, 7],
    'Authorized Signature',
    rc.kind !== 'DEBIT_NOTE' ? f(EN, 9, { underline: true }) : f(EN, 9, { bold: true }),
    'right',
  );
  height(ws, r + 2, 14);
  return r + 3;
}

/* ------------------------------ Handover checklist ------------------------------ */

/** "IMP & EXP SHIPMENT-CHECKING LIST": the originals handed to the client, to sign for. */
function checklistSheet(
  wb: Workbook,
  pack: BillingPack,
  month: string,
  c: CompanyInfo,
  preparedBy: string,
  today: string,
) {
  const ws = a4Sheet(wb, 'Checklist', { left: 14, right: 14, top: 14, bottom: 16 });
  ws.columns = px(40, 260, 130, 110, 148);
  const t = f(EN, 9.4);
  const b = f(EN, 9.4, { bold: true });
  const dmy = 'dd\\-mm\\-yyyy';
  const client = (pack.client.legalName ?? pack.client.name).toUpperCase();
  const rich = (label: string, value: string) =>
    ({
      richText: [
        { text: label, font: b },
        { text: value, font: t },
      ],
    }) as never;
  height(ws, 1, 6);
  put(ws, 2, [1, 3], rich('From: ', c.nameEn ?? ''), t);
  put(ws, 2, [4, 5], null, t, 'right');
  ws.getCell(2, 4).value = {
    richText: [
      { text: 'Date: ', font: b },
      { text: `${today.slice(8, 10)}-${today.slice(5, 7)}-${today.slice(0, 4)}`, font: t },
    ],
  };
  put(ws, 3, [1, 3], rich('To: ', client), t);
  put(
    ws,
    4,
    [1, 5],
    `Subject: IMP & EXP SHIPMENT-CHECKING LIST · ${periodCode(month)}`,
    b,
    'left',
    {
      valign: 'bottom',
    },
  );
  [14, 14, 14, 20].forEach((pt, i) => height(ws, i + 2, pt));
  height(ws, 5, 14);

  const grey = { style: 'thin', color: { argb: 'FF6B7280' } } as const;
  const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } } as const;
  const cell = f(EN, 8.6);
  let r = 6;
  ['No', 'DOC NO', 'DECLARE NO', 'DATE', 'REMARK'].forEach((h, i) =>
    Object.assign(put(ws, r, [i + 1, i + 1], h, f(EN, 8.6, { bold: true }), 'center'), {
      fill: yellow,
      border: box(grey),
    }),
  );
  height(ws, r, 20);
  ws.pageSetup.printTitlesRow = `${r}:${r}`; // the headings again on each page
  r += 1;
  const rows = checklistRows(pack, month);
  rows.forEach((x, i) => {
    const values = [i + 1, x.doc, x.declare, x.date ? dateCell(x.date) : '', 'ORIGINAL'];
    values.forEach((v, j) =>
      Object.assign(
        put(ws, r, [j + 1, j + 1], v, cell, j === 1 ? 'left' : 'center', {
          wrap: j === 1,
          numFmt: j === 3 ? dmy : undefined,
        }),
        { border: box(grey) },
      ),
    );
    height(ws, r, 8 + 13 * Math.max(1, Math.ceil(x.doc.length / 34)));
    r += 1;
  });
  height(ws, r, 8);
  put(ws, r + 1, [1, 3], `TOTAL: ${rows.length}`, f(EN, 8.6, { bold: true }));
  height(ws, r + 2, 30);
  r += 3;

  // Prepared by on the left, received by on the right.
  const sign = f(EN, 8.6);
  const signB = f(EN, 8.6, { bold: true });
  const blank = '_______________________________';
  const L: [number, number] = [1, 2];
  const R: [number, number] = [3, 5];
  const lines: [string, string, boolean][] = [
    ['PREPARED BY:', `RECEIVED BY: ${client}`, true],
    [`NAME: ${preparedBy}`, `NAME: ${blank}`, false],
    [
      `DATE: ${today.slice(8, 10)}-${today.slice(5, 7)}-${today.slice(0, 4)}`,
      `DATE: ${blank}`,
      false,
    ],
    [`SIGNATURE: ${blank}`, `SIGNATURE: ${blank}`, false],
  ];
  for (const [l, rt, bold] of lines) {
    put(ws, r, L, l, bold ? signB : sign);
    put(ws, r, R, rt, bold ? signB : sign);
    height(ws, r, 19);
    r += 1;
  }
  ws.pageSetup.printArea = `A1:E${r - 1}`;
}
