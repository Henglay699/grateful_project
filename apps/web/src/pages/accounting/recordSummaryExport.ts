import type { Borders, Cell, Font, Workbook, Worksheet } from 'exceljs';
import { isVatChargedLine, vatFactor, type BillingDoc } from '@gs/shared';
import type { CompanyInfo } from '../../features/accounting';
import { saveBlob } from '../../lib/files';
import { SHIPMENT_SEPARATOR, pricedLines, recordSummaryHeader } from '../print/PrintDocPage';

/*
 * Excel for a Record Summary, built from what is on screen (the live preview) and laid out
 * like the sheet: letterhead with the logo, the boxed header, the gray item table with live
 * formulas. Same approach as the Credit Noted export.
 */

/** "RecordSummary_I_122050": the declare no. (or the client) names the file. */
export function recordSummaryFileName(d: BillingDoc): string {
  const ref = (d.header.declareNo || d.clientCode || 'Doc').trim();
  return `RecordSummary_${ref.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
}

export async function exportRecordSummaryExcel(
  d: BillingDoc,
  c: CompanyInfo,
  port: string | undefined,
  forwarder: string | undefined,
) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const logo = await logoDataUrl();
  addRecordSummarySheet(wb, d, c, port, forwarder, logo);
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${recordSummaryFileName(d)}.xlsx`,
  );
}

/** Record Summary → ⋯ → Excel Pack: one workbook, one sheet per summary (named by declare no.). */
export async function exportRecordSummaryPackExcel(
  summaries: { doc: BillingDoc; port: string | undefined; forwarder: string | undefined }[],
  c: CompanyInfo,
  fileName: string,
) {
  const [{ default: ExcelJS }, logo] = await Promise.all([import('exceljs'), logoDataUrl()]);
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const { doc, port, forwarder } of summaries) {
    // Excel sheet names: at most 31 characters, none of : \ / ? * [ ], unique.
    const base = (doc.header.declareNo || doc.clientCode || 'Record Summary')
      .replace(/[:\\/?*[\]]/g, '-')
      .slice(0, 31)
      .trim();
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++)
      name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    used.add(name.toLowerCase());
    addRecordSummarySheet(wb, doc, c, port, forwarder, logo, name);
  }
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  );
}

/** The letterhead logo as a data URL, or null when it can't be fetched (export goes on). */
export async function logoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch('/logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const FONT = 'Calibri';
// Table head and TOTAL row: the same gray as the credit note.
const GRAY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDBDBD' } } as const;
const BLACK = { style: 'thin', color: { argb: 'FF000000' } } as const;
const UNDERLINE = { style: 'hair', color: { argb: 'FFC0C0C0' } } as const;
const BOX = { top: BLACK, left: BLACK, bottom: BLACK, right: BLACK };
/** Zero shows as "-", like the sheet. */
const MONEY = '#,##0.00;-#,##0.00;"-"';
const font = (extra: Partial<Font> = {}): Partial<Font> => ({ name: FONT, size: 10, ...extra });

export function addRecordSummarySheet(
  wb: Workbook,
  d: BillingDoc,
  c: CompanyInfo,
  port: string | undefined,
  forwarder: string | undefined,
  logo: string | null,
  sheetName = 'Record Summary',
) {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [
    { width: 5.5 }, // A  NO               | header box: left label (A–B)
    { width: 17 }, //  B  DESCRIPTION (B–C) |
    { width: 30 }, //  C                    | left value
    { width: 7 }, //   D  Q'TY              | right label (D–F)
    { width: 8 }, //   E  SHIP              |
    { width: 10 }, //  F  PRICE             |
    { width: 12 }, //  G  SUBTOTAL            | right value (G–H)
    { width: 15 }, //  H  MARK              |
  ];

  let r = 1;
  // Letterhead: logo on the left, the company centred across the page.
  const centred = (row: number, value: string, f: Partial<Font>, height: number) => {
    ws.mergeCells(row, 1, row, 8);
    Object.assign(ws.getCell(row, 1), {
      value,
      font: f,
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    ws.getRow(row).height = height;
  };
  centred(r, c.nameKm ?? '', { name: 'Khmer OS Muol Light', size: 12 }, 26);
  centred(r + 1, c.nameEn ?? '', font({ size: 11, bold: true }), 17);
  centred(
    r + 2,
    `លេខអត្តសញ្ញាណកម្ម អតប (VATTIN) : ${c.vattin ?? ''}`,
    { name: 'Khmer OS Siemreap', size: 9 },
    17,
  );
  if (logo)
    ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), {
      tl: { col: 0.4, row: 0.1 },
      ext: { width: 78, height: 78 },
    });
  r += 3;
  ws.getRow(r).height = 8;
  r += 1;
  centred(r, 'RECORD SUMMARY', font({ size: 14, bold: true, underline: true }), 24);
  r += 2;

  // Header box: rows pair up left / right, each value underlined, the whole box outlined.
  const header = recordSummaryHeader(d, port, forwarder);
  const top = r;
  const bottom = r + Math.ceil(header.length / 2) - 1;
  for (let i = 0; i < header.length; i += 2) {
    const row = r + i / 2;
    pair(ws, row, [1, 2], [3, 3], header[i]!);
    if (header[i + 1]) pair(ws, row, [4, 6], [7, 8], header[i + 1]!);
    ws.getRow(row).height = 17;
  }
  for (let row = top; row <= bottom; row++)
    for (let col = 1; col <= 8; col++) {
      const cell = ws.getCell(row, col);
      const b: Partial<Borders> = { ...cell.border };
      if (row === top) b.top = BLACK;
      if (col === 1) b.left = BLACK;
      if (col === 8) b.right = BLACK;
      cell.border = b;
    }
  // The last row's values keep their grey underline; the box's bottom edge goes below it.
  r = bottom + 1;
  for (let col = 1; col <= 8; col++)
    ws.getCell(r, col).border = { ...ws.getCell(r, col).border, top: BLACK };
  ws.getRow(r).height = 8;
  r += 1;

  // Item table: NO, DESCRIPTION (B–C), Q'TY, UNIT, PRICE, SUBTOTAL, MARK.
  const head = r;
  ws.mergeCells(head, 2, head, 3);
  (['NO', 'DESCRIPTION', null, "Q'TY", 'UNIT', 'PRICE', 'SUBTOTAL', 'MARK'] as const).forEach(
    (t, i) => {
      const cell = ws.getCell(head, i + 1);
      if (t) cell.value = t;
      Object.assign(cell, {
        fill: GRAY,
        border: BOX,
        font: font({ bold: true }),
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
    },
  );
  ws.getRow(head).height = 18;
  r += 1;

  const first = r;
  const lines = pricedLines(d);
  lines.forEach((l, i) => {
    const row = r;
    ws.mergeCells(row, 2, row, 3);
    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = l.description;
    ws.getCell(row, 4).value = Number(l.qty) || 0;
    ws.getCell(row, 5).value = l.unit;
    ws.getCell(row, 6).value = Number(l.unitPrice) || 0;
    ws.getCell(row, 7).value = {
      // The processing fee: the document's VAT on top (10% → ×1.1), as in the system.
      formula: isVatChargedLine(l.description)
        ? `ROUND(ROUND(D${row}*F${row},2)*${vatFactor(d.header.vatRate ?? undefined)},2)`
        : `ROUND(D${row}*F${row},2)`,
      result: Number(l.subtotal) || 0,
    };
    ws.getCell(row, 8).value = l.mark ?? '';
    const align = ['center', 'left', 'left', 'center', 'center', 'right', 'right', 'center'];
    for (let col = 1; col <= 8; col++)
      Object.assign(ws.getCell(row, col), {
        border: BOX,
        font: font(),
        alignment: { horizontal: align[col - 1], vertical: 'middle', indent: col === 2 ? 1 : 0 },
      });
    ws.getCell(row, 6).numFmt = MONEY;
    ws.getCell(row, 7).numFmt = MONEY;
    r += 1;
  });
  const last = r - 1;

  // TOTAL row
  ws.mergeCells(r, 1, r, 6);
  ws.getCell(r, 1).value = 'TOTAL:';
  ws.getCell(r, 7).value = lines.length
    ? { formula: `SUM(G${first}:G${last})`, result: Number(d.totals.total) || 0 }
    : 0;
  for (let col = 1; col <= 8; col++)
    Object.assign(ws.getCell(r, col), { fill: GRAY, border: BOX, font: font({ bold: true }) });
  ws.getCell(r, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell(r, 7).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell(r, 7).numFmt = '#,##0.00';
}

/** One label / value pair of the header box; SHIPMENT's bar is drawn in red. */
function pair(
  ws: Worksheet,
  row: number,
  [l1, l2]: [number, number],
  [v1, v2]: [number, number],
  [label, value]: [string, string],
) {
  if (l2 > l1) ws.mergeCells(row, l1, row, l2);
  if (v2 > v1) ws.mergeCells(row, v1, row, v2);
  Object.assign(ws.getCell(row, l1), {
    value: label,
    font: font({ bold: true }),
    alignment: { horizontal: 'left', vertical: 'middle', indent: l1 === 1 ? 1 : 0 },
  });
  const cell: Cell = ws.getCell(row, v1);
  const bold = font({ bold: true });
  if (label === 'SHIPMENT:') {
    const [dir, by] = value.split(SHIPMENT_SEPARATOR);
    cell.value = {
      richText: [
        { text: `${dir} `, font: bold },
        { text: '|', font: { ...bold, color: { argb: 'FFA11D1D' } } },
        { text: ` ${by ?? ''}`, font: bold },
      ],
    };
  } else {
    cell.value = value;
    cell.font = bold;
  }
  cell.alignment = { horizontal: 'left', vertical: 'middle', shrinkToFit: true };
  for (let col = v1; col <= v2; col++)
    ws.getCell(row, col).border = { ...ws.getCell(row, col).border, bottom: UNDERLINE };
}
